import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { GateResult } from '../../shared/gate'
import type { PolicyState } from '../../shared/policy'
import { auditPath } from './audit-log'
import { SHA, isPush, okResponder, policyState, makeKit, type Kit } from './gate-test-kit'

const kits: Kit[] = []
const kit = async (...a: Parameters<typeof makeKit>): Promise<Kit> => {
  const k = await makeKit(...a)
  kits.push(k)
  return k
}
afterEach(async () => {
  for (const k of kits.splice(0)) await k.cleanup()
})

const pending = async (k: Kit): Promise<string[]> =>
  readdir(join(k.c.dir, 'company/decisions/pending')).catch(() => [])
const auditText = (k: Kit): Promise<string> =>
  readFile(join(k.c.dir, auditPath('my-company')), 'utf8')
const push = (k: Kit, branch?: unknown): Promise<GateResult> =>
  k.svc.call(k.ctx, 'gate_push', branch === undefined ? {} : { branch })

describe('gate_push modes', () => {
  it('every/batch modes create a card and never push', async () => {
    for (const mode of ['every', 'batch'] as const) {
      const k = await kit()
      k.policy.value = policyState({ push: mode })
      const r = await push(k, 'feature/x')
      expect(r.status).toBe('card')
      expect(k.calls.some(isPush)).toBe(false)
      expect((await pending(k)).some((f) => f.includes('git-confirm'))).toBe(true)
    }
  })

  it('auto pushes an allowed branch with a fixed refspec and writes one audit line', async () => {
    const k = await kit()
    const r = await push(k, 'feature/x')
    expect(r.status).toBe('executed')
    const call = k.calls.find(isPush)
    expect(call?.args.slice(-2)).toEqual(['origin', 'refs/heads/feature/x:refs/heads/feature/x'])
    const text = await auditText(k)
    const rows = text.split('\n').filter((l) => l.startsWith('| 2026'))
    expect(rows).toEqual([
      `| 2026-11-13T03:00:00.000Z | push | feature/x@${SHA.slice(0, 7)} | executed | developer | T-053 | 자동 | 1/3 |`
    ])
  })

  it('resolves HEAD to the actual branch before checking it', async () => {
    const k = await kit({
      responder: okResponder((_c, args) =>
        args.includes('symbolic-ref')
          ? { code: 0, stdout: 'refs/heads/master\n' }
          : { code: -1, stdout: '' }
      )
    })
    const r = await push(k, 'HEAD')
    expect(r.status).toBe('card')
    expect(k.calls.some(isPush)).toBe(false)
  })

  it.each(['master', 'Main', 'release/1.0', 'develop', 'hotfix/x'])(
    'branch %s outside the allowlist or protected falls back to a card',
    async (b) => {
      const k = await kit()
      const r = await push(k, b)
      expect(r.status).toBe('card')
      expect(k.calls.some(isPush)).toBe(false)
    }
  )

  it.each([
    'refs/heads/master',
    'origin/master',
    '-f',
    '+feature/x',
    'feature/x:master',
    'a b',
    'feature/../x'
  ])('rejects malformed or ref-prefixed branch input %s', async (b) => {
    const k = await kit()
    const r = await push(k, b)
    expect(r.status).toBe('blocked')
    expect(k.calls.some(isPush)).toBe(false)
  })

  it('rejects force-style tool inputs outright', async () => {
    const k = await kit()
    for (const input of [
      { branch: 'feature/x', force: true },
      { branch: 'feature/x', args: ['--force'] }
    ]) {
      expect((await k.svc.call(k.ctx, 'gate_push', input)).status).toBe('blocked')
    }
    expect(k.calls.some(isPush)).toBe(false)
  })

  it('invalid auto setups fall back to a card (no activation, no limit, PM required, no bridge)', async () => {
    const cases: ((k: Kit) => void)[] = [
      (k) => (k.policy.value = policyState({ activated: false })),
      (k) => (k.policy.value = policyState({ limits: {} })),
      (k) => (k.project.state = 'pm-required'),
      (k) => (k.ctx.autoAllowed = false),
      (k) => (k.policy.value = null)
    ]
    for (const setup of cases) {
      const k = await kit()
      setup(k)
      const r = await push(k, 'feature/x')
      expect(r.status).toBe('card')
      expect(k.calls.some(isPush)).toBe(false)
    }
  })
})

describe('daily limit', () => {
  it('allows exactly the limit, blocks the next with a decision card, and resets at company midnight', async () => {
    const k = await kit()
    k.policy.value = policyState({ limits: { push: 2 } })
    // 서울 자정 직전(14:59Z = 23:59 KST)과 직후(15:00Z)를 가른다.
    k.clock.now = new Date('2026-11-13T14:58:00.000Z')
    const shaCalls: string[] = []
    for (const b of ['feature/a', 'feature/b', 'feature/c']) {
      const r = await push(k, b)
      shaCalls.push(r.status)
    }
    // 같은 해시라 키가 다르려면 브랜치가 달라야 한다 (위 세 브랜치는 서로 다르다).
    expect(shaCalls).toEqual(['executed', 'executed', 'blocked'])
    expect(k.calls.filter(isPush)).toHaveLength(2)
    const files = await pending(k)
    expect(files.some((f) => f.endsWith('-gate-decision.md'))).toBe(true)
    expect(await auditText(k)).toContain('blocked-limit')

    k.clock.now = new Date('2026-11-13T15:00:00.000Z')
    expect((await push(k, 'feature/c')).status).toBe('executed')
  })
})

describe('kill switch', () => {
  it('turns auto into a card immediately and survives release only through set()', async () => {
    const k = await kit()
    await k.killSwitch.set({ scope: 'project', projectId: 'my-company', engaged: true })
    const r = await push(k, 'feature/x')
    expect(r.status).toBe('card')
    expect(k.calls.some(isPush)).toBe(false)
    expect(await auditText(k)).toContain('blocked-killswitch')
    expect(k.history[0]).toContain('킬 스위치 켬')
    await k.killSwitch.set({ scope: 'project', projectId: 'my-company', engaged: false })
    expect((await push(k, 'feature/x')).status).toBe('executed')
  })

  it('company-wide switch applies to every project', async () => {
    const k = await kit()
    await k.killSwitch.set({ scope: 'company', engaged: true })
    expect((await push(k, 'feature/x')).status).toBe('card')
  })

  it('aborts an in-flight push when engaged and does not retry', async () => {
    let started!: () => void
    const startedP = new Promise<void>((r) => (started = r))
    const k = await kit({
      responder: okResponder(async (_c, args, signal) => {
        if (!args.includes('push')) return { code: -1, stdout: '' }
        started()
        await new Promise<void>((res) => signal?.addEventListener('abort', () => res()))
        return { code: 0, stdout: '' }
      })
    })
    const p = push(k, 'feature/x')
    await startedP
    await k.killSwitch.set({ scope: 'company', engaged: true })
    const r = await p
    expect(r.status).toBe('failed')
    expect(await auditText(k)).toContain('blocked-killswitch')
  })

  it('treats an unreadable state as engaged and refuses release', async () => {
    const { KillSwitch } = await import('./kill-switch')
    const ks = new KillSwitch({
      store: {
        load: async () => {
          throw new Error('corrupt')
        },
        save: async () => undefined
      }
    })
    expect(await ks.isEngaged('my-company')).toBe(true)
    await expect(ks.set({ scope: 'company', engaged: false })).rejects.toThrow()
    await expect(ks.set({ scope: 'company', engaged: true })).resolves.toMatchObject({
      company: true
    })
  })
})

describe('idempotency and no retry', () => {
  it('does not push the same ref and commit twice', async () => {
    const k = await kit()
    expect((await push(k, 'feature/x')).status).toBe('executed')
    expect((await push(k, 'feature/x')).status).toBe('duplicate')
    expect(k.calls.filter(isPush)).toHaveLength(1)
    expect(await ledgerCount(k)).toBe(1)
  })

  it('records a failure once, leaves a card, and refuses to retry the same request', async () => {
    const k = await kit({
      responder: okResponder((_c, args) =>
        args.includes('push') ? { code: 1, stdout: '' } : { code: -1, stdout: '' }
      )
    })
    const first = await push(k, 'feature/x')
    expect(first.status).toBe('failed')
    expect(first.cardId).toBeDefined()
    const second = await push(k, 'feature/x')
    expect(second.status).toBe('blocked')
    expect(k.calls.filter(isPush)).toHaveLength(1)
    expect(await auditText(k)).toContain('| failed |')
    expect((await pending(k)).filter((f) => f.endsWith('-gate-decision.md'))).toHaveLength(1)
  })

  it('does not create duplicate confirm cards for the same request', async () => {
    const k = await kit()
    k.policy.value = policyState({ push: 'every' })
    const a = await push(k, 'feature/x')
    const b = await push(k, 'feature/x')
    expect(a.cardId).toBe(b.cardId)
  })
})

async function ledgerCount(k: Kit): Promise<number> {
  return k.ledger.count('my-company', 'push', k.clock.now)
}

describe('gate_merge', () => {
  const merge = (k: Kit, pr: number): Promise<GateResult> => k.svc.call(k.ctx, 'gate_merge', { pr })
  const autoMerge = (over = {}): PolicyState =>
    policyState({ merge: 'auto', limits: { merge: 2 }, mergeBranches: ['develop'], ...over })

  it('merges an allowed base with --match-head-commit and nothing else dangerous', async () => {
    const k = await kit()
    k.policy.value = autoMerge()
    const r = await merge(k, 7)
    expect(r.status).toBe('executed')
    const call = k.calls.find((c) => c.command === 'gh' && c.args[1] === 'merge')
    expect(call?.args).toEqual(['pr', 'merge', '7', '--merge', '--match-head-commit', SHA])
  })

  it('falls back to a card without a reviewer-qa pass record or without usePr', async () => {
    for (const setup of [
      (k: Kit) => (k.reviewPassed.value = false),
      (k: Kit) => (k.policy.value = autoMerge({ usePr: false }))
    ]) {
      const k = await kit()
      k.policy.value = autoMerge()
      setup(k)
      expect((await merge(k, 7)).status).toBe('card')
      expect(k.calls.some((c) => c.args[1] === 'merge')).toBe(false)
    }
  })

  it('rejects draft, closed, or unreadable PRs', async () => {
    for (const body of [
      { state: 'OPEN', isDraft: true },
      { state: 'MERGED', isDraft: false }
    ]) {
      const k = await kit({
        responder: okResponder((c, a) =>
          c === 'gh' && a[1] === 'view'
            ? {
                code: 0,
                stdout: JSON.stringify({
                  baseRefName: 'develop',
                  headRefName: 'x',
                  headRefOid: SHA,
                  ...body
                })
              }
            : { code: -1, stdout: '' }
        )
      })
      k.policy.value = autoMerge()
      expect((await merge(k, 7)).status).toBe('blocked')
    }
  })

  it('protected base needs the protected option, and its cap is at most 2 per day', async () => {
    const toMain = okResponder((c, a) =>
      c === 'gh' && a[1] === 'view'
        ? {
            code: 0,
            stdout: JSON.stringify({
              baseRefName: 'refs/heads/main'.replace('refs/heads/', ''),
              headRefName: 'x',
              headRefOid: SHA,
              state: 'OPEN',
              isDraft: false
            })
          }
        : { code: -1, stdout: '' }
    )
    const off = await kit({ responder: toMain })
    off.policy.value = autoMerge({ mergeBranches: ['main'], protectedMerge: false })
    expect((await merge(off, 1)).status).toBe('card')

    const on = await kit({ responder: toMain })
    on.policy.value = autoMerge({
      mergeBranches: ['main'],
      protectedMerge: true,
      limits: { merge: 10 }
    })
    // 같은 PR 번호·같은 커밋은 멱등 키가 같으므로 번호를 바꿔 센다.
    const statuses = [
      (await merge(on, 1)).status,
      (await merge(on, 2)).status,
      (await merge(on, 3)).status
    ]
    expect(statuses).toEqual(['executed', 'executed', 'blocked'])
  })

  it('a non-listed base falls back to a card', async () => {
    const k = await kit()
    k.policy.value = autoMerge({ mergeBranches: ['staging'] })
    expect((await merge(k, 7)).status).toBe('card')
  })
})

describe('audit and tool inputs', () => {
  it('never contains credential-like values even if a branch name tries', async () => {
    const k = await kit()
    const r = await push(k, 'feature/ghp_abcdefghijklmnop1234')
    expect(r.status).toBe('executed')
    const text = await auditText(k)
    expect(text).not.toContain('ghp_abcdefghijklmnop1234')
  })

  it('refuses unknown tools, ids, and projects', async () => {
    const k = await kit()
    expect((await k.svc.call(k.ctx, 'gate_delete', {})).status).toBe('blocked')
    expect((await k.svc.call({ ...k.ctx, employeeId: '../x' }, 'gate_push', {})).status).toBe(
      'blocked'
    )
    expect((await k.svc.call({ ...k.ctx, ticketId: 'x' }, 'gate_push', {})).status).toBe('blocked')
    expect((await k.svc.call({ ...k.ctx, projectId: 'A/B' }, 'gate_push', {})).status).toBe(
      'blocked'
    )
  })
})
