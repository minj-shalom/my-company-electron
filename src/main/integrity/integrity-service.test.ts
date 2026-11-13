import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CompanyWatcher } from '../cache/company-watcher'
import { createFileGateCards } from '../gate/gate-cards'
import { createMemoryStateStore, type StateStore } from '../gate/state-store'
import { appWrite } from '../domain-ipc'
import { createIntegrityHandlers } from './integrity-ipc'
import { HR_AUDIT_FILE, HrAudit } from './hr-audit'
import { IntegrityStateStore } from './integrity-state'
import { IntegrityService } from './integrity-service'
import { filesWithSecrets, sha256 } from './protected-files'
import { judgeSensitive } from './sensitive'
import { readProtectedFiles } from './protected-files'
import { SnapshotStore } from './snapshot-store'
import { cleanup, company, put } from './test-kit'

const tmp: string[] = []
afterEach(async () => {
  await cleanup()
  for (const d of tmp.splice(0)) await rm(d, { recursive: true, force: true })
})

interface Setup {
  c: Awaited<ReturnType<typeof company>>
  svc: IntegrityService
  snapshots: SnapshotStore
  state: IntegrityStateStore
  read: (rel: string) => Promise<string>
  write: (rel: string, text: string) => Promise<void>
  /** 앱 함수처럼 SafeFs로 쓴다 (변경 감지가 앱 쓰기로 인정하는 경로). */
  appWrite: (rel: string, text: string) => Promise<void>
  cards: () => Promise<Array<{ kind: string; text: string }>>
  audit: () => Promise<string[]>
  snapDir: string
}

async function setup(stateStore: StateStore = createMemoryStateStore()): Promise<Setup> {
  const c = await company()
  const snapDir = await mkdtemp(join(tmpdir(), 'mc-isnap-'))
  tmp.push(snapDir)
  const exclusive = <T>(t: () => Promise<T>): Promise<T> => c.repo.runExclusive(t)
  const snapshots = new SnapshotStore(snapDir, () => new Date(), filesWithSecrets)
  const state = new IntegrityStateStore(stateStore)
  const svc = new IntegrityService({
    fs: c.fs,
    exclusive,
    snapshots,
    state,
    audit: new HrAudit({ fs: c.fs, exclusive }),
    cards: createFileGateCards({ fs: c.fs, exclusive })
  })
  await svc.reconcile() // 기준선
  const read = (rel: string): Promise<string> => readFile(join(c.dir, rel), 'utf8')
  const write = (rel: string, text: string): Promise<void> => put(c.dir, rel, text)
  const cards = async (): Promise<Array<{ kind: string; text: string }>> => {
    const dir = join(c.dir, 'company/decisions/pending')
    const out: Array<{ kind: string; text: string }> = []
    for (const f of (await readdir(dir)).filter((x) => x.includes('-gate-'))) {
      const text = await readFile(join(dir, f), 'utf8')
      out.push({ kind: /\*\*유형:\*\* (\S+)/.exec(text)?.[1] ?? '', text })
    }
    return out
  }
  const audit = async (): Promise<string[]> =>
    (await c.fs.readText(HR_AUDIT_FILE)).split('\n').filter((l) => l.startsWith('| 20'))
  const appWrite = (rel: string, text: string): Promise<void> => c.fs.writeText(rel, text)
  return { c, svc, appWrite, snapshots, state, read, write, cards, audit, snapDir }
}

const addBash = (t: string): string => t.replace(/tools: .*\n/, (m) => `${m.trimEnd()}, Bash\n`)

describe('baseline and clean changes', () => {
  it('initializes once and reports no change afterwards', async () => {
    const t = await setup()
    expect((await t.svc.reconcile()).status).toBe('unchanged')
    expect(await t.snapshots.count()).toBe(1)
  })

  it('accepts a harmless edit, audits it and moves the baseline', async () => {
    const t = await setup()
    const text = await t.read('.claude/agents/reviewer-qa.md')
    await t.write('.claude/agents/reviewer-qa.md', `${text}\n추가 지침\n`)
    const r = await t.svc.reconcile({ hint: 'hr-direct' })
    expect(r.status).toBe('clean')
    expect(await t.cards()).toEqual([])
    const [line] = await t.audit()
    expect(line).toContain('| .claude/agents/reviewer-qa.md | +')
    expect(line).toContain('| hr-direct | ok | - |')
    expect((await t.svc.reconcile()).status).toBe('unchanged')
  })
})

describe('sensitive change detection', () => {
  it('flags Bash added to a tools list: card, quarantine, audit, no duplicate card', async () => {
    const t = await setup()
    const text = await t.read('.claude/agents/reviewer-qa.md')
    await t.write('.claude/agents/reviewer-qa.md', addBash(text))
    const r = await t.svc.reconcile()
    expect(r.status).toBe('flagged')
    const cards = await t.cards()
    expect(cards.map((x) => x.kind)).toEqual(['revert-suggestion'])
    expect(cards[0].text).toContain('도구(Bash, 쓰기) 확대: reviewer-qa')
    expect(await t.svc.isQuarantined('reviewer-qa')).toBe(true)
    expect(await t.svc.isQuarantined('pm')).toBe(false)
    expect((await t.audit())[0]).toContain('| unknown | unapproved | D-')
    await t.svc.reconcile()
    expect(await t.cards()).toHaveLength(1)
  })

  it('judges protected agent edits, removals and org rows', async () => {
    const t = await setup()
    const before = await readProtectedFiles(t.c.fs)
    const edit = new Map(before)
    const cto = `${before.get('.claude/agents/cto.md')!.text}x`
    edit.set('.claude/agents/cto.md', { text: cto, hash: sha256(cto) })
    expect(judgeSensitive(before, edit).map((s) => [s.kind, s.employeeId])).toEqual([
      ['protected-edit', 'cto']
    ])
    const gone = new Map(before)
    gone.delete('.claude/agents/reviewer-qa.md')
    expect(judgeSensitive(before, gone).map((s) => s.kind)).toEqual(['employee-removal'])
    const org = before.get('company/org.md')!.text!
    const edited = org.replace(/(\| COO[^\n]*\|)\s*([^|\n]*)\|\n/, '$1 변경된 역할 |\n')
    const row = new Map(before).set('company/org.md', { text: edited, hash: sha256(edited) })
    expect(judgeSensitive(before, row).map((s) => s.kind)).toEqual(['protected-edit'])
    const removed = org
      .split('\n')
      .filter((l) => !l.includes('`reviewer-qa`'))
      .join('\n')
    const rm = new Map(before).set('company/org.md', { text: removed, hash: sha256(removed) })
    expect(judgeSensitive(before, rm).map((s) => s.kind)).toEqual(['employee-removal'])
    // tools 축소나 Bash 없는 변경은 민감하지 않다.
    const same = new Map(before)
    const dev = (before.get('.claude/agents/reviewer-qa.md')!.text ?? '').replace(
      'Read, Grep, Glob',
      'Read'
    )
    same.set('.claude/agents/reviewer-qa.md', { text: dev, hash: sha256(dev) })
    expect(judgeSensitive(before, same)).toEqual([])
  })

  it('treats a matching approval hash as approved-proposal and a mismatch as unapproved', async () => {
    const t = await setup()
    const text = addBash(await t.read('.claude/agents/reviewer-qa.md'))
    const f = '.claude/agents/reviewer-qa.md'
    const before = sha256(await t.read(f))
    await t.svc.approve(f, before, sha256(`${text}nope`))
    await t.write('.claude/agents/reviewer-qa.md', text)
    expect((await t.svc.reconcile()).status).toBe('flagged')
    // 승인이 뒤늦게 도착하면 다시 판정한다.
    await t.svc.approve(f, before, sha256(text))
    const r = await t.svc.reconcile()
    expect(r.status).toBe('clean')
    expect((await t.audit()).at(-1)).toContain('| approved-proposal | ok |')
  })

  it('quarantines protected agent edits and removals', async () => {
    const t = await setup()
    await t.write('.claude/agents/cto.md', `${await t.read('.claude/agents/cto.md')}\nhack\n`)
    await rm(join(t.c.dir, '.claude/agents/pm.md'))
    expect((await t.svc.reconcile()).status).toBe('flagged')
    expect(await t.svc.quarantined()).toEqual(['cto', 'pm'])
  })
})

describe('restore and accept', () => {
  it('restores the last good snapshot (round trip), snapshots the current state, lifts quarantine', async () => {
    const t = await setup()
    const orig = await t.read('.claude/agents/reviewer-qa.md')
    const orgOrig = await t.read('company/org.md')
    await t.write('.claude/agents/reviewer-qa.md', addBash(orig))
    await t.write('.claude/agents/stray.md', '---\nname: stray\ndescription: d\n---\n\nx\n')
    await rm(join(t.c.dir, 'company/org.md'))
    await t.svc.reconcile()
    const before = await t.snapshots.count()
    const r = await t.svc.restore()
    expect(r).toEqual({ ok: true, restored: 3 })
    expect(await t.read('.claude/agents/reviewer-qa.md')).toBe(orig)
    expect(await t.read('company/org.md')).toBe(orgOrig)
    await expect(readFile(join(t.c.dir, '.claude/agents/stray.md'))).rejects.toThrow()
    expect(await t.snapshots.count()).toBe(before + 1)
    expect(await t.svc.quarantined()).toEqual([])
    expect((await t.svc.reconcile()).status).toBe('unchanged')
    expect((await t.audit()).filter((l) => l.includes('| restored |'))).toHaveLength(3)
  })

  it('accept approves the current state, moves the baseline and lifts quarantine', async () => {
    const t = await setup()
    await t.write(
      '.claude/agents/reviewer-qa.md',
      addBash(await t.read('.claude/agents/reviewer-qa.md'))
    )
    await t.svc.reconcile()
    expect(await t.svc.accept()).toEqual({ ok: true, restored: 1 })
    expect(await t.svc.isQuarantined('reviewer-qa')).toBe(false)
    expect((await t.svc.reconcile()).status).toBe('unchanged')
    expect((await t.audit()).at(-1)).toContain('| ceo-ui | accepted |')
  })

  it('refuses to accept a validation failure', async () => {
    const t = await setup()
    await t.write(
      'company/project.md',
      (await t.read('company/project.md')).replace('../alpha', '../x')
    )
    await t.svc.reconcile()
    const r = await t.svc.accept()
    expect(r).toEqual({ ok: false, code: 'validation-failed', files: ['company/project.md'] })
  })

  it('reports not-restorable when the baseline has files over the size limit', async () => {
    const t = await setup()
    const big = `---\nname: big\ndescription: d\n---\n\n${'a'.repeat(1_100_000)}`
    await t.write('.claude/agents/big.md', big)
    // 기준선을 다시 만들어 큰 파일이 이미 있던 상태를 기준으로 삼는다.
    await rm(t.snapDir, { recursive: true, force: true })
    expect((await t.svc.reconcile()).status).toBe('initialized')
    await t.write(
      'company/project.md',
      (await t.read('company/project.md')).replace('Alpha', 'Zed')
    )
    await t.svc.reconcile()
    expect(await t.svc.restore()).toEqual({
      ok: false,
      code: 'not-restorable',
      files: ['.claude/agents/big.md']
    })
    expect(await t.read('company/project.md')).toContain('Zed')
  })

  it('has no baseline error before the first snapshot', async () => {
    const t = await setup()
    await rm(t.snapDir, { recursive: true, force: true })
    expect(await t.svc.restore()).toEqual({ ok: false, code: 'no-baseline', files: [] })
  })
})

describe('project.md, policies, PM state', () => {
  it('allows 직원 line edits and flags other lines with a revert card', async () => {
    const t = await setup()
    const md = await t.read('company/project.md')
    await t.write('company/project.md', md.replace('직원: developer, ui-dev', '직원: developer'))
    expect((await t.svc.reconcile()).status).toBe('clean')
    await t.write('company/project.md', md.replace('유형: content', '유형: other'))
    expect((await t.svc.reconcile()).status).toBe('flagged')
    expect((await t.cards()).map((x) => x.kind)).toEqual(['revert-suggestion'])
    expect((await t.audit()).at(-1)).toContain('violation:project-line-changed')
  })

  it('raises an integrity-warning for validation failures that are not settings changes', async () => {
    const t = await setup()
    const text = await t.read('.claude/agents/reviewer-qa.md')
    await t.write('.claude/agents/reviewer-qa.md', text.replace(/name: .*/, 'name: other'))
    await t.svc.reconcile()
    expect((await t.cards()).map((x) => x.kind)).toEqual(['integrity-warning'])
    expect(await t.svc.quarantined()).toEqual([])
  })

  it('flags external policy edits but not app writes', async () => {
    const t = await setup()
    await t.write('company/policies/alpha.md', '# 정책\n')
    expect((await t.svc.reconcile()).status).toBe('flagged')
    expect((await t.cards())[0].kind).toBe('revert-suggestion')
    await t.svc.restore()
    await t.svc.withAppWrite('ceo-ui', () => t.appWrite('company/policies/alpha.md', '# 정책 v2\n'))
    expect(await t.cards()).toHaveLength(1)
    expect((await t.audit()).at(-1)).toContain('| ceo-ui | ok |')
  })

  it('flags external publishing record edits but not app writes', async () => {
    const t = await setup()
    await t.write('company/publishing/blog.md', '# 발행 기록\n')
    expect((await t.svc.reconcile()).status).toBe('flagged')
    expect((await t.cards())[0].kind).toBe('revert-suggestion')
    await t.svc.restore()
    expect(await t.c.fs.exists('company/publishing/blog.md')).toBe(false)
    await t.svc.withAppWrite('ceo-ui', () =>
      t.appWrite('company/publishing/blog.md', '# 발행 기록 v2\n')
    )
    expect(await t.cards()).toHaveLength(1)
  })

  it('flags external recurring.md edits but not app writes, and restores the snapshot', async () => {
    const t = await setup()
    await t.write('company/recurring.md', '# 반복 업무\n')
    expect((await t.svc.reconcile()).status).toBe('flagged')
    expect((await t.cards())[0].kind).toBe('revert-suggestion')
    expect((await t.audit()).at(-1)).toContain('policy-changed')
    await t.svc.restore()
    expect(await t.c.fs.exists('company/recurring.md')).toBe(false)
    await t.svc.withAppWrite('ceo-ui', () => t.appWrite('company/recurring.md', '# 반복 업무 v2\n'))
    expect(await t.cards()).toHaveLength(1)
    expect((await t.audit()).at(-1)).toContain('| ceo-ui | ok |')
  })

  it('records PM removal as an info card and a state change, not a violation', async () => {
    const t = await setup()
    await t.write(
      'company/project.md',
      (await t.read('company/project.md')).replace('- PM: pm\n', '')
    )
    const r = await t.svc.reconcile()
    expect(r.status).toBe('clean')
    expect((await t.cards()).map((x) => x.kind)).toEqual(['decision'])
    expect((await t.audit())[0]).toContain('info:pm-needed')
  })

  it('detects the PM employee being retired as PM needed', async () => {
    const t = await setup()
    await rm(join(t.c.dir, '.claude/agents/pm.md'))
    const org = (await t.read('company/org.md')).split('\n').filter((l) => !l.includes('`pm`'))
    await t.write('company/org.md', org.join('\n'))
    const r = await t.svc.reconcile()
    expect(r.issues.map((i) => i.code)).toContain('pm-needed')
    expect((await t.cards()).map((x) => x.kind)).toContain('decision')
  })
})

describe('app writes are ignored', () => {
  it('does not warn or quarantine for sensitive changes the app itself wrote', async () => {
    const t = await setup()
    await t.svc.withAppWrite('ceo-ui', async () => {
      await t.appWrite(
        '.claude/agents/reviewer-qa.md',
        addBash(await t.read('.claude/agents/reviewer-qa.md'))
      )
      await t.appWrite('.claude/agents/cto.md', `${await t.read('.claude/agents/cto.md')}\nok\n`)
    })
    expect(await t.cards()).toEqual([])
    expect(await t.svc.quarantined()).toEqual([])
    const lines = await t.audit()
    expect(lines).toHaveLength(2)
    expect(lines.every((l) => l.includes('| ceo-ui | ok | - |'))).toBe(true)
    expect((await t.svc.reconcile()).status).toBe('unchanged')
  })

  it('settles earlier external changes first so they are not mistaken for app writes', async () => {
    const t = await setup()
    await t.write('.claude/agents/cto.md', `${await t.read('.claude/agents/cto.md')}\nsneaky\n`)
    await t.svc.withAppWrite('ceo-ui', async () => {
      await t.appWrite('.claude/agents/pm.md', `${await t.read('.claude/agents/pm.md')}\n보충\n`)
    })
    expect((await t.cards()).map((x) => x.kind)).toEqual(['revert-suggestion'])
    expect(await t.svc.isQuarantined('cto')).toBe(true)
    expect((await t.svc.restore()).ok).toBe(true)
    expect(await t.read('.claude/agents/cto.md')).not.toContain('sneaky')
  })

  it('treats an external change made during the window as unknown, not as the app', async () => {
    const t = await setup()
    await t.svc.withAppWrite('ceo-ui', async () => {
      await t.appWrite('.claude/agents/pm.md', `${await t.read('.claude/agents/pm.md')}\n보충\n`)
      // 창 안에서 앱이 쓰지 않은 파일(외부)과, 앱이 쓴 뒤 다시 바뀐 파일.
      await t.write(
        '.claude/agents/reviewer-qa.md',
        addBash(await t.read('.claude/agents/reviewer-qa.md'))
      )
      await t.write('.claude/agents/pm.md', `${await t.read('.claude/agents/pm.md')}\nexternal\n`)
    })
    expect((await t.cards()).map((x) => x.kind)).toEqual(['revert-suggestion'])
    expect(await t.svc.isQuarantined('reviewer-qa')).toBe(true)
    const lines = await t.audit()
    expect(lines.every((l) => l.includes('| unknown |'))).toBe(true)
  })

  it('still raises a card when an app write produces a validation violation', async () => {
    const t = await setup()
    await t.svc.withAppWrite('ceo-ui', () =>
      t.appWrite('company/project.md', 'x\n## 프로젝트: Alpha\n- id: alpha\n- 경로: ../z\n')
    )
    expect((await t.cards()).map((x) => x.kind)).toEqual(['revert-suggestion'])
    expect((await t.audit())[0]).toContain('| ceo-ui | violation:')
  })

  it('does not let a later app write hide a new sensitive change while an issue is pending', async () => {
    const t = await setup()
    await t.write('.claude/agents/cto.md', `${await t.read('.claude/agents/cto.md')}\nA\n`)
    await t.svc.reconcile()
    await t.write(
      '.claude/agents/reviewer-qa.md',
      addBash(await t.read('.claude/agents/reviewer-qa.md'))
    )
    await t.svc.withAppWrite('ceo-ui', async () =>
      t.appWrite('.claude/agents/pm.md', `${await t.read('.claude/agents/pm.md')}\nx\n`)
    )
    expect(await t.svc.isQuarantined('reviewer-qa')).toBe(true)
    expect((await t.cards()).length).toBe(2)
  })

  it('fails closed: refuses the app write when state cannot be read', async () => {
    const bad: StateStore = {
      load: async () => {
        throw new Error('corrupt')
      },
      save: async () => undefined
    }
    const t = await setup()
    const svc = new IntegrityService({
      fs: t.c.fs,
      exclusive: (x) => x(),
      snapshots: t.snapshots,
      state: new IntegrityStateStore(bad),
      audit: new HrAudit({ fs: t.c.fs, exclusive: (x) => x() }),
      cards: createFileGateCards({ fs: t.c.fs, exclusive: (x) => x() })
    })
    let ran = false
    await expect(
      svc.withAppWrite('ceo-ui', async () => {
        ran = true
      })
    ).rejects.toThrow()
    expect(ran).toBe(false)
    expect(await svc.isQuarantined('pm')).toBe(true)
  })
})

describe('guarded actions and approvals', () => {
  it('refuses restore/accept when the state changed after the card was made', async () => {
    const t = await setup()
    await t.write(
      '.claude/agents/reviewer-qa.md',
      addBash(await t.read('.claude/agents/reviewer-qa.md'))
    )
    await t.svc.reconcile()
    const hash = /상태 해시: ([0-9a-f]{64})/.exec((await t.cards())[0].text)![1]
    await t.write('.claude/agents/cto.md', `${await t.read('.claude/agents/cto.md')}\nlate\n`)
    expect(await t.svc.accept(hash)).toEqual({ ok: false, code: 'stale', files: [] })
    expect(await t.svc.restore(hash)).toEqual({ ok: false, code: 'stale', files: [] })
    expect(await t.svc.isQuarantined('reviewer-qa')).toBe(true)
    await t.svc.reconcile()
    const h2 = /상태 해시: ([0-9a-f]{64})/.exec((await t.cards()).at(-1)!.text)![1]
    expect((await t.svc.restore(h2)).ok).toBe(true)
  })

  it('consumes an approval after one use and ties it to before -> after', async () => {
    const t = await setup()
    const f = '.claude/agents/reviewer-qa.md'
    const orig = await t.read(f)
    const bashed = addBash(orig)
    await t.svc.approve(f, sha256(orig), sha256(bashed))
    await t.write(f, bashed)
    expect((await t.svc.reconcile()).status).toBe('clean')
    await t.write(f, orig)
    expect((await t.svc.reconcile()).status).toBe('clean')
    // 같은 해시로 다시 바꿔도 승인은 이미 쓰였다.
    await t.write(f, bashed)
    expect((await t.svc.reconcile()).status).toBe('flagged')
  })

  it('expires approvals after 7 days', async () => {
    const t = await setup()
    const f = '.claude/agents/reviewer-qa.md'
    const orig = await t.read(f)
    const bashed = addBash(orig)
    await t.svc.approve(f, sha256(orig), sha256(bashed))
    await t.state.update((d) => {
      d.approvals[0].at = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString()
    })
    await t.write(f, bashed)
    expect((await t.svc.reconcile()).status).toBe('flagged')
  })

  it('does not repeat the PM card or audit lines while the state is unchanged', async () => {
    const t = await setup()
    await t.write(
      'company/project.md',
      (await t.read('company/project.md')).replace('- PM: pm\n', '')
    )
    await t.write(
      '.claude/agents/reviewer-qa.md',
      addBash(await t.read('.claude/agents/reviewer-qa.md'))
    )
    await t.svc.reconcile()
    const n = (await t.cards()).length
    const lines = (await t.audit()).length
    await t.svc.reconcile()
    await t.svc.reconcile()
    expect((await t.cards()).length).toBe(n)
    expect((await t.audit()).length).toBe(lines)
  })

  it('raises a card for a secret pattern present at first run', async () => {
    const c = await company()
    await put(
      c.dir,
      '.claude/agents/pm.md',
      `${await readFile(join(c.dir, '.claude/agents/pm.md'), 'utf8')}\nghp_${'c'.repeat(30)}\n`
    )
    const snapDir = await mkdtemp(join(tmpdir(), 'mc-isnap-'))
    tmp.push(snapDir)
    const ex = <T>(x: () => Promise<T>): Promise<T> => c.repo.runExclusive(x)
    const svc = new IntegrityService({
      fs: c.fs,
      exclusive: ex,
      snapshots: new SnapshotStore(snapDir, () => new Date(), filesWithSecrets),
      state: new IntegrityStateStore(createMemoryStateStore()),
      audit: new HrAudit({ fs: c.fs, exclusive: ex }),
      cards: createFileGateCards({ fs: c.fs, exclusive: ex })
    })
    expect((await svc.reconcile()).status).toBe('flagged')
    expect((await svc.reconcile()).cardIds).toEqual([])
    const files = await readdir(join(c.dir, 'company/decisions/pending'))
    expect(files.filter((x) => x.includes('integrity-warning'))).toHaveLength(1)
  })

  it('rejects a snapshot whose contents do not match its hashes', async () => {
    const t = await setup()
    const [f] = (await readdir(t.snapDir)).filter((x) => x.endsWith('.json'))
    const p = join(t.snapDir, f)
    const j = JSON.parse(await readFile(p, 'utf8'))
    j.files['company/org.md'] = 'tampered'
    await writeFile(p, JSON.stringify(j))
    expect(await t.snapshots.latestBaseline()).toBeNull()
  })

  it('catches project.md CRLF conversion and reordered lines as violations', async () => {
    const t = await setup()
    const md = await t.read('company/project.md')
    await t.write('company/project.md', md.replace('- PM: pm\n', '- PM: pm\r\n'))
    const r1 = await t.svc.reconcile()
    expect(['clean', 'flagged']).toContain(r1.status)
    await t.svc.restore()
    await t.write(
      'company/project.md',
      md.replace('- id: alpha\n- 유형: development\n', '- 유형: development\n- id: alpha\n')
    )
    expect((await t.svc.reconcile()).status).toBe('flagged')
  })
})

describe('secrets and state safety', () => {
  it('stops snapshotting and warns when a secret pattern appears', async () => {
    const t = await setup()
    const count = await t.snapshots.count()
    await t.write(
      '.claude/agents/reviewer-qa.md',
      `${await t.read('.claude/agents/reviewer-qa.md')}\nghp_${'a'.repeat(30)}\n`
    )
    const r = await t.svc.reconcile()
    expect(r.status).toBe('flagged')
    expect(await t.snapshots.count()).toBe(count)
    const [card] = await t.cards()
    expect(card.kind).toBe('integrity-warning')
    expect(card.text).not.toContain('ghp_')
    expect((await t.audit()).join('\n')).not.toContain('ghp_')
  })

  it('answers quarantined for everyone when the state cannot be read', async () => {
    const bad: StateStore = {
      load: async () => {
        throw new Error('corrupt')
      },
      save: async () => undefined
    }
    const state = new IntegrityStateStore(bad)
    expect(await state.isQuarantined('pm')).toBe(true)
  })

  it('ignores prototype-polluting ids in a stored state', async () => {
    const store = createMemoryStateStore(
      JSON.parse(
        '{"quarantine":{"__proto__":{"file":"a","reason":"b"},"pm":{"file":"a","reason":"b"}}}'
      )
    )
    const state = new IntegrityStateStore(store)
    expect(await state.quarantined()).toEqual(['pm'])
  })
})

describe('ipc handlers', () => {
  it('fail closed without a state directory', async () => {
    const h = createIntegrityHandlers({ context: {} as never })
    const stateHash = 'a'.repeat(64)
    for (const r of [
      await h.getQuarantined(),
      await h.restoreIntegrity({ stateHash }),
      await h.acceptIntegrity({ stateHash })
    ])
      expect(r.ok).toBe(false)
  })

  it('rejects restore and accept without a valid state hash before touching any state', async () => {
    const h = createIntegrityHandlers({ context: {} as never, userDataDir: '/unused' })
    for (const bad of [
      undefined,
      null,
      {},
      { stateHash: 1 },
      { stateHash: 'xyz' },
      { stateHash: 'A'.repeat(64) },
      { stateHash: 'a'.repeat(63) }
    ])
      for (const call of [h.restoreIntegrity, h.acceptIntegrity]) {
        const r = await call(bad)
        expect(r.ok).toBe(false)
        if (!r.ok) expect(r.code).toBe('invalid-request')
      }
  })
})

describe('appWrite wrapper', () => {
  it('runs the function unguarded when no userData directory is configured (tests, unconfigured)', async () => {
    const run = appWrite({ context: {} as never, userDataDir: undefined }, async (a) => ({
      ok: true as const,
      value: a
    }))
    expect(await run(7)).toEqual({ ok: true, value: 7 })
  })
})

describe('watcher hook', () => {
  it('wires onProtectedChange to reconcile with a real CompanyWatcher', async () => {
    const t = await setup()
    const w = new CompanyWatcher({
      root: await realpath(t.c.dir),
      debounceMs: 50,
      onChange: async () => undefined,
      onProtectedChange: async () => void (await t.svc.reconcile())
    })
    await w.start()
    try {
      await new Promise((r) => setTimeout(r, 500))
      await t.write(
        '.claude/agents/reviewer-qa.md',
        addBash(await t.read('.claude/agents/reviewer-qa.md'))
      )
      for (let i = 0; i < 50 && (await t.svc.quarantined()).length === 0; i++)
        await new Promise((r) => setTimeout(r, 100))
      expect(await t.svc.quarantined()).toEqual(['reviewer-qa'])
      expect((await t.cards()).map((x) => x.kind)).toEqual(['revert-suggestion'])
    } finally {
      await w.stop()
    }
  })

  it('calls onProtectedChange for project.md, archive and policies, not for tickets', async () => {
    const t = await setup()
    const calls: number[] = []
    const w = new CompanyWatcher({
      root: await realpath(t.c.dir),
      debounceMs: 50,
      onChange: async () => undefined,
      onProtectedChange: async () => void calls.push(Date.now())
    })
    await w.start()
    try {
      await new Promise((r) => setTimeout(r, 500))
      calls.length = 0
      await t.write('company/tickets/backlog/T-900-x.md', '# t\n')
      await new Promise((r) => setTimeout(r, 600))
      expect(calls).toHaveLength(0)
      await t.write('company/project.md', (await t.read('company/project.md')) + '\n')
      for (let i = 0; i < 40 && calls.length === 0; i++)
        await new Promise((r) => setTimeout(r, 100))
      expect(calls.length).toBeGreaterThan(0)
      calls.length = 0
      await t.write('company/policies/x.md', '# p\n')
      for (let i = 0; i < 40 && calls.length === 0; i++)
        await new Promise((r) => setTimeout(r, 100))
      expect(calls.length).toBeGreaterThan(0)
    } finally {
      await w.stop()
    }
  })
})
