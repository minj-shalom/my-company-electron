import { existsSync } from 'node:fs'
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Decision } from '../shared/decision'
import { CompanyContext } from './company/company-context'
import { createDomainHandlers } from './domain-ipc'
import { ProviderService } from './providers/provider-service'
import { createWeeklyLimitsStore } from './settings/weekly-limits-store'

const FIXTURES = join(__dirname, 'repository', 'fixtures', 'decisions')

let dir: string
let outside: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mc-dec-'))
  outside = await mkdtemp(join(tmpdir(), 'mc-dec-out-'))
  await writeFile(join(dir, 'CLAUDE.md'), '# c\n')
  await put('company/org.md', '# 조직도\n')
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
  await rm(outside, { recursive: true, force: true })
})

async function put(rel: string, content: string): Promise<void> {
  const abs = join(dir, rel)
  await mkdir(dirname(abs), { recursive: true })
  await writeFile(abs, content)
}
async function fixture(name: string, status: 'pending' | 'done'): Promise<void> {
  const abs = join(dir, 'company/decisions', status, name)
  await mkdir(dirname(abs), { recursive: true })
  await copyFile(join(FIXTURES, name), abs)
}

async function handlers(open = true): Promise<ReturnType<typeof createDomainHandlers>> {
  const context = new CompanyContext({
    store: { load: async () => null, save: async () => undefined },
    homeDir: '/nonexistent-home'
  })
  if (open) expect((await context.open(dir)).ok).toBe(true)
  return createDomainHandlers({
    context,
    providers: new ProviderService(),
    limits: createWeeklyLimitsStore(dir)
  })
}

const card = (extra = '', n = 20): string => `# D-0${n}: 테스트 카드

- **관련 티켓:** T-014
- **작성일:** 2026-11-13
- **상태:** pending
${extra}
## 질문
진행할까요?

## 선택지
1. **A. 승인** — 진행
2. **B. 거절** — 중단

## 추천안과 이유
- 추천: A

## 결정 (사람이 작성)
- 선택:
- 메모:
`

const list = async (
  h: ReturnType<typeof createDomainHandlers>,
  s?: unknown
): Promise<Decision[]> => {
  const r = await h.listDecisions(s)
  if (!r.ok) throw new Error(r.code)
  return r.value.items
}

describe('decision:list', () => {
  it('requires an open company', async () => {
    const h = await handlers(false)
    expect(await h.listDecisions(undefined)).toMatchObject({ ok: false, code: 'no-company' })
    expect(await h.resolveDecision({ id: 'D-004', choice: 'A' })).toMatchObject({
      ok: false,
      code: 'no-company'
    })
  })

  it('parses real cards copied from the company folder', async () => {
    await fixture('D-004-employee-file-schema.md', 'pending')
    await fixture('D-016-weekly-limit-unit.md', 'pending')
    await fixture('D-012-headless-permission-policy.md', 'done')
    await fixture('D-001-initial-decisions.md', 'done')
    const h = await handlers()
    const pending = await list(h, 'pending')
    expect(pending.map((d) => d.id)).toEqual(['D-004', 'D-016'])
    expect(pending[0]).toMatchObject({
      status: 'pending',
      ticketId: 'T-003',
      recommended: 'A',
      kind: 'decision',
      proposedBy: null
    })
    expect(pending[0].options.map((o) => o.key)).toEqual(['A', 'B', 'C'])
    const done = await list(h, 'done')
    expect(done.map((d) => d.id)).toEqual(['D-001', 'D-012'])
    expect((await list(h)).length).toBe(4)
  })

  it('rejects bad status values', async () => {
    const h = await handlers()
    for (const bad of ['all', '', 1, null, {}, '../done'])
      expect(await h.listDecisions(bad)).toMatchObject({ ok: false, code: 'invalid-request' })
  })

  it('keeps listing when one card is corrupt, and skips symlinked cards', async () => {
    await fixture('D-004-employee-file-schema.md', 'pending')
    await put('company/decisions/pending/D-030-broken.md', '제목 없는 카드\n')
    await put('company/decisions/pending/not-a-card.md', '# x\n')
    await writeFile(join(outside, 'D-031-x.md'), card('', 31))
    await symlink(join(outside, 'D-031-x.md'), join(dir, 'company/decisions/pending/D-031-x.md'))
    const h = await handlers()
    expect((await list(h, 'pending')).map((d) => d.id)).toEqual(['D-004'])
  })

  it('returns empty when the decision folders do not exist', async () => {
    expect(await list(await handlers())).toEqual([])
  })
})

describe('card type and proposer', () => {
  const kindOf = async (extra: string): Promise<Decision> => {
    await put('company/decisions/pending/D-020-t.md', card(extra))
    return (await list(await handlers(), 'pending'))[0]
  }

  it('defaults to decision when the line is missing', async () => {
    expect(await kindOf('')).toMatchObject({ kind: 'decision', proposedBy: null })
  })

  it('accepts every allow-listed type', async () => {
    for (const k of [
      'decision',
      'permission',
      'proposal',
      'content-approval',
      'integrity-warning',
      'revert-suggestion',
      'git-confirm'
    ]) {
      expect((await kindOf(`- **유형:** ${k}`)).kind).toBe(k)
    }
  })

  it('falls back to decision for unknown or hostile values', async () => {
    for (const v of ['hacker', '<script>alert(1)</script>', '', 'PROPOSAL2', 'proposal; drop'])
      expect((await kindOf(`- **유형:** ${v}`)).kind).toBe('decision')
  })

  it('parses the proposer only for allowed values', async () => {
    expect(await kindOf('- **유형:** proposal\n- **제안자:** hr')).toMatchObject({
      kind: 'proposal',
      proposedBy: 'hr'
    })
    expect((await kindOf('- **제안자:** coo')).proposedBy).toBe('coo')
    expect((await kindOf('- **제안자:** ceo')).proposedBy).toBeNull()
    expect((await kindOf('- **제안자:** hr<img>')).proposedBy).toBeNull()
  })
})

describe('decision:resolve', () => {
  const pendingPath = (n = 20): string => join(dir, `company/decisions/pending/D-0${n}-t.md`)
  const donePath = (n = 20): string => join(dir, `company/decisions/done/D-0${n}-t.md`)

  it('writes the choice and memo, then moves the card to done', async () => {
    await put('company/decisions/pending/D-020-t.md', card())
    const h = await handlers()
    const r = await h.resolveDecision({ id: 'D-020', choice: 'B', memo: '보류\n다음 주' })
    expect(r).toMatchObject({
      ok: true,
      value: { status: 'done', chosen: 'B', memo: '보류\n다음 주' }
    })
    expect(existsSync(pendingPath())).toBe(false)
    const text = await readFile(donePath(), 'utf8')
    expect(text).toContain('- 선택: B')
    expect(text).toContain('**상태:** done')
    // 원본의 나머지 내용은 그대로다.
    expect(text).toContain('## 추천안과 이유')
    expect(await readdir(join(dir, 'company/decisions/done'))).toEqual(['D-020-t.md'])
  })

  it('works on a real card with trailing sections', async () => {
    await fixture('D-004-employee-file-schema.md', 'pending')
    const h = await handlers()
    expect(await h.resolveDecision({ id: 'D-004', choice: 'A' })).toMatchObject({
      ok: true,
      value: { chosen: 'A' }
    })
    const text = await readFile(
      join(dir, 'company/decisions/done/D-004-employee-file-schema.md'),
      'utf8'
    )
    expect(text).toContain('## 영향 갱신 (2026-11-12)')
  })

  it('validates the request shape, id, choice and memo', async () => {
    await put('company/decisions/pending/D-020-t.md', card())
    const h = await handlers()
    const bad: unknown[] = [
      null,
      undefined,
      'D-020',
      [],
      {},
      { id: 'D-020' },
      { id: 'D-020', choice: 1 },
      { id: 'D-020', choice: '' },
      { id: 'D-020', choice: 'Z' },
      { id: 'D-020', choice: 'a' },
      { id: 'D-020', choice: 'A', memo: 5 },
      { id: 'D-020', choice: 'A', memo: 'x'.repeat(2001) },
      { id: '../D-020', choice: 'A' },
      { id: 'D-020-t', choice: 'A' },
      { id: '../../etc/passwd', choice: 'A' },
      { id: 'D-020\0', choice: 'A' }
    ]
    for (const b of bad)
      expect(await h.resolveDecision(b)).toMatchObject({ ok: false, code: 'invalid-request' })
    expect(existsSync(pendingPath())).toBe(true)
    expect(existsSync(donePath())).toBe(false)
  })

  it('returns not-found and conflict with fixed messages', async () => {
    await put('company/decisions/done/D-021-t.md', card('', 21).replace('pending', 'done'))
    const h = await handlers()
    const nf = await h.resolveDecision({ id: 'D-099', choice: 'A' })
    expect(nf).toMatchObject({ ok: false, code: 'not-found' })
    const cf = await h.resolveDecision({ id: 'D-021', choice: 'A' })
    expect(cf).toMatchObject({ ok: false, code: 'conflict' })
    expect(JSON.stringify([nf, cf])).not.toContain(dir)
  })

  it('does not write an unknown choice and leaves the card untouched', async () => {
    await put('company/decisions/pending/D-020-t.md', card())
    const before = await readFile(pendingPath(), 'utf8')
    await (await handlers()).resolveDecision({ id: 'D-020', choice: 'C' })
    expect(await readFile(pendingPath(), 'utf8')).toBe(before)
  })

  it('double click: exactly one succeeds, the other is a conflict', async () => {
    await put('company/decisions/pending/D-020-t.md', card())
    const h = await handlers()
    const req = { id: 'D-020', choice: 'A', memo: '같은 요청' }
    const results = await Promise.all([h.resolveDecision(req), h.resolveDecision(req)])
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(results.find((r) => !r.ok)).toMatchObject({ code: 'conflict' })
    expect(await readdir(join(dir, 'company/decisions/done'))).toEqual(['D-020-t.md'])
    expect(existsSync(pendingPath())).toBe(false)
  })

  it('concurrent resolves with different choices: first wins, file keeps one coherent choice', async () => {
    await put('company/decisions/pending/D-020-t.md', card())
    const h = await handlers()
    const results = await Promise.all([
      h.resolveDecision({ id: 'D-020', choice: 'A' }),
      h.resolveDecision({ id: 'D-020', choice: 'B' }),
      h.resolveDecision({ id: 'D-020', choice: 'A', memo: 'later' })
    ])
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    const text = await readFile(donePath(), 'utf8')
    expect(text.match(/^- 선택:/gm)).toHaveLength(1)
    const winner = results.find((r) => r.ok)
    expect(winner).toMatchObject({ value: { chosen: text.includes('- 선택: A') ? 'A' : 'B' } })
  })

  it('serializes resolves of different cards without interference', async () => {
    await put('company/decisions/pending/D-020-t.md', card())
    await put('company/decisions/pending/D-022-t.md', card('', 22))
    const h = await handlers()
    const rs = await Promise.all([
      h.resolveDecision({ id: 'D-020', choice: 'A' }),
      h.resolveDecision({ id: 'D-022', choice: 'B' })
    ])
    expect(rs.every((r) => r.ok)).toBe(true)
    expect(await readdir(join(dir, 'company/decisions/pending'))).toEqual([])
  })

  it('refuses to overwrite a different done card with the same name (name collision)', async () => {
    await put('company/decisions/pending/D-020-t.md', card())
    await put('company/decisions/done/D-020-t.md', card().replace('pending', 'done'))
    // 이름 충돌: done에 내용이 다른 같은 이름 카드가 이미 있다. 덮어쓰지 않는다.
    const h = await handlers()
    expect(await h.resolveDecision({ id: 'D-020', choice: 'A' })).toMatchObject({
      ok: false,
      code: 'conflict'
    })
    expect(existsSync(pendingPath())).toBe(true)
    expect(await readFile(donePath(), 'utf8')).toContain('**상태:** done')
    expect(await readFile(donePath(), 'utf8')).not.toContain('- 선택: A')
  })

  it('leaves no partial files when the move fails midway', async () => {
    await put('company/decisions/pending/D-020-t.md', card())
    const h = await handlers()
    // 새 위치 쓰기는 성공하지만 원본 삭제가 실패하는 상황을 만든다 (pending 폴더를 읽기 전용으로).
    const { chmod } = await import('node:fs/promises')
    await chmod(join(dir, 'company/decisions/pending'), 0o555)
    try {
      const r = await h.resolveDecision({ id: 'D-020', choice: 'A' })
      if (process.getuid?.() === 0) return // root는 권한 검사를 우회한다
      expect(r).toMatchObject({ ok: false, code: 'internal' })
      expect(JSON.stringify(r)).not.toContain(dir)
    } finally {
      await chmod(join(dir, 'company/decisions/pending'), 0o755)
    }
    if (process.getuid?.() === 0) return
    expect(existsSync(pendingPath())).toBe(true)
    expect(existsSync(donePath())).toBe(false)
    expect(await readdir(join(dir, 'company/decisions/done')).catch(() => [])).toEqual([])
    // 실패 후 재시도하면 정상 처리된다.
    expect(await h.resolveDecision({ id: 'D-020', choice: 'A' })).toMatchObject({ ok: true })
  })

  it('refuses a symlinked decisions folder and does not write outside the company', async () => {
    await mkdir(join(dir, 'company/decisions'), { recursive: true })
    await mkdir(join(outside, 'pending'), { recursive: true })
    await writeFile(join(outside, 'pending/D-020-t.md'), card())
    await symlink(join(outside, 'pending'), join(dir, 'company/decisions/pending'))
    const h = await handlers()
    expect(await list(h)).toEqual([])
    const r = await h.resolveDecision({ id: 'D-020', choice: 'A' })
    expect(r.ok).toBe(false)
    expect(await readdir(outside)).toEqual(['pending'])
    expect(await readFile(join(outside, 'pending/D-020-t.md'), 'utf8')).toBe(card())
  })

  it('does not inject extra sections through the memo', async () => {
    await put('company/decisions/pending/D-020-t.md', card())
    const h = await handlers()
    const memo = '첫 줄\n## 가짜 섹션\n- 선택: B\n```\n끝'
    const r = await h.resolveDecision({ id: 'D-020', choice: 'A', memo })
    expect(r).toMatchObject({ ok: true, value: { chosen: 'A' } })
    const text = await readFile(donePath(), 'utf8')
    expect(text.match(/^## /gm)).toHaveLength(4)
  })
})
