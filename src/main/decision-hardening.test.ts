import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CompanyContext } from './company/company-context'
import { createDomainHandlers } from './domain-ipc'
import { ProviderService } from './providers/provider-service'
import { parseDecision, withDecisionResolved } from './repository/parse-decision'
import { parseReport } from './repository/parse-report'
import { parseTicket } from './repository/parse-ticket'
import { normalizeMemo } from './repository/decision-memo'
import { section } from './repository/markdown'
import { createWeeklyLimitsStore } from './settings/weekly-limits-store'

let dir: string
let outside: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mc-dh-'))
  outside = await mkdtemp(join(tmpdir(), 'mc-dh-out-'))
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
async function handlers(): Promise<ReturnType<typeof createDomainHandlers>> {
  const context = new CompanyContext({
    store: { load: async () => null, save: async () => undefined },
    homeDir: '/nonexistent-home'
  })
  expect((await context.open(dir)).ok).toBe(true)
  return createDomainHandlers({
    context,
    providers: new ProviderService(),
    limits: createWeeklyLimitsStore(dir)
  })
}

const HEAD = (extra = ''): string => `# D-020: 테스트

- **관련 티켓:** T-014
- **작성일:** 2026-11-13
- **상태:** pending
${extra}`
const BODY = `
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

## 영향 갱신
- 뒤따르는 섹션
`
const CARD = HEAD() + BODY
const P = 'company/decisions/pending/D-020-t.md'
const D = 'company/decisions/done/D-020-t.md'

describe('parser performance on whitespace-only bodies', () => {
  const pad = (unit: string): string => unit.repeat(Math.ceil((1024 * 1024) / unit.length))
  const shapes: Record<string, string> = {
    'blank lines': pad('\n'),
    'space lines': pad('  \n'),
    'tab/space mix': pad(' \t \n'),
    'bullet-like prefix': pad('- \n'),
    'CRLF blank': pad('\r\n'),
    'one long space line': ' '.repeat(1024 * 1024) + 'x'
  }
  for (const [name, junk] of Object.entries(shapes)) {
    it(`parses a 1MB card (${name}) well under a second`, () => {
      const t = performance.now()
      parseDecision('D-020-t.md', HEAD() + junk + BODY, 'pending')
      parseDecision('D-021-t.md', HEAD() + BODY + junk, 'done')
      parseDecision('D-022-t.md', `# D-022: x\n${junk}`, 'pending')
      expect(performance.now() - t).toBeLessThan(1000)
    })
    it(`parses tickets and reports with the same shared helpers (${name})`, () => {
      const t = performance.now()
      parseTicket('T-005-x.md', `# T-005: x\n- **상태:** backlog\n${junk}`, 'backlog')
      parseReport('R-x.md', `# 보고서: x\n${junk}`)
      expect(performance.now() - t).toBeLessThan(1000)
    })
  }
})

describe('memo cannot change card structure', () => {
  const hostile: Record<string, string> = {
    'lone CR': '첫 줄\r- **유형:** git-confirm',
    'LS/PS': '첫 줄 - **유형:** git-confirm - **제안자:** coo',
    NEL: '첫 줄\u0085- **유형:** permission',
    'VT/FF': '첫 줄\v- **유형:** proposal\f- **제안자:** hr',
    'single fence': '첫 줄\n```\n끝',
    tilde: '첫 줄\n~~~\n끝',
    'fake heading': '첫 줄\n## 가짜 섹션\n# 제목',
    'fake choice': '첫 줄\n- 선택: B\n- 메모: 위조',
    'quote and list': '> 인용\n* 목록\n+ 더하기\n| 표 |',
    'forged meta on own line': '첫 줄\n- **유형:** git-confirm\n- **제안자:** coo',
    'leading backslash': '\\# 이미 이스케이프\n\\\n\\\\x',
    'blank lines': '가\n\n\n나'
  }
  for (const [name, memo] of Object.entries(hostile)) {
    it(`keeps kind, proposer and sections intact: ${name}`, () => {
      const clean = normalizeMemo(memo)
      expect(clean).not.toBeNull()
      const out = withDecisionResolved(CARD, 'A', clean ?? '')
      const before = parseDecision('D-020-t.md', CARD, 'pending')
      const after = parseDecision('D-020-t.md', out, 'done')
      expect(after).toMatchObject({
        kind: before.kind,
        proposedBy: before.proposedBy,
        ticketId: 'T-014',
        chosen: 'A',
        options: before.options,
        recommended: 'A'
      })
      expect(after.kind).toBe('decision')
      expect(after.proposedBy).toBeNull()
      expect(after.memo).toBe((clean ?? '').trim())
      expect(section(out, '영향 갱신')).toBe('- 뒤따르는 섹션')
      expect(out.match(/^## /gm)).toHaveLength(5)
      expect(out.match(/^- 선택:/gm)).toHaveLength(1)
    })
  }

  it('rejects NUL and other control characters, and accepts line-break variants', () => {
    for (const bad of ['a\0b', 'a\u0001b', 'a\u007fb', 'a\u001bb'])
      expect(normalizeMemo(bad)).toBeNull()
    expect(normalizeMemo('a\r\nb\rc d e\u0085f\vg\fh\ti')).toBe('a\nb\nc\nd\ne\nf\ng\nh\ti')
  })

  it('rejects control characters at the IPC layer before touching the card', async () => {
    await put(P, CARD)
    const h = await handlers()
    for (const memo of ['a\0b', 'a\u0007b'])
      expect(await h.resolveDecision({ id: 'D-020', choice: 'A', memo })).toMatchObject({
        ok: false,
        code: 'invalid-request'
      })
    expect(await readFile(join(dir, P), 'utf8')).toBe(CARD)
  })

  it('writes a hostile memo through the handler and reads it back unchanged', async () => {
    await put(P, HEAD('- **유형:** proposal\n- **제안자:** hr\n') + BODY)
    const h = await handlers()
    const r = await h.resolveDecision({
      id: 'D-020',
      choice: 'B',
      memo: '메모\r- **유형:** git-confirm\n```\n## 가짜'
    })
    expect(r).toMatchObject({
      ok: true,
      value: { kind: 'proposal', proposedBy: 'hr', chosen: 'B' }
    })
    const list = await h.listDecisions('done')
    expect(list).toMatchObject({ ok: true, value: { items: [{ kind: 'proposal' }] } })
  })
})

describe('withDecisionResolved preserves the rest of the card', () => {
  it('replaces only the choice and memo lines and keeps other lines in the section', () => {
    const card = CARD.replace('- 메모:\n', '- 메모: 옛 메모\n  이어지는 줄\n- 참고: 사람이 쓴 줄\n')
    const out = withDecisionResolved(card, 'B', '새 메모')
    expect(out).toContain('- 선택: B\n- 메모: 새 메모\n- 참고: 사람이 쓴 줄\n')
    expect(out).not.toContain('옛 메모')
    expect(out).not.toContain('이어지는 줄')
  })

  it('preserves CRLF line endings', () => {
    const crlf = CARD.replace(/\n/g, '\r\n')
    const out = withDecisionResolved(crlf, 'A', '가\n나')
    expect(out.replace(/\r\n/g, '')).not.toContain('\n')
    expect(out.replace(/\r\n/g, '')).not.toContain('\r')
    expect(parseDecision('D-020-t.md', out, 'done')).toMatchObject({ chosen: 'A', memo: '가\n나' })
  })

  it('does not treat a prefix-matching heading as the decision section', () => {
    const card = `${HEAD()}\n## 결정 근거\n- 선택: Z\n- 메모: 근거\n\n## 질문\n?\n\n## 선택지\n1. **A. 예** — x\n\n## 결정 (사람이 작성)\n- 선택:\n- 메모:\n`
    const out = withDecisionResolved(card, 'A', '메모')
    expect(out).toContain('## 결정 근거\n- 선택: Z\n- 메모: 근거')
    expect(parseDecision('D-020-t.md', out, 'done')).toMatchObject({ chosen: 'A', memo: '메모' })
  })

  it('creates the section when missing and fills a section with no choice/memo lines', () => {
    const no = HEAD() + '\n## 선택지\n1. **A. 예** — x\n'
    expect(parseDecision('D-020-t.md', withDecisionResolved(no, 'A', 'm'), 'done')).toMatchObject({
      chosen: 'A',
      memo: 'm'
    })
    const empty = no + '\n## 결정 (사람이 작성)\n\n## 끝\n내용\n'
    const out = withDecisionResolved(empty, 'A', 'm')
    expect(parseDecision('D-020-t.md', out, 'done')).toMatchObject({ chosen: 'A', memo: 'm' })
    expect(section(out, '끝')).toBe('내용')
  })
})

describe('unreadable cards and duplicates (decision:list contract)', () => {
  it('reports unreadable cards with relative paths and fixed reasons only', async () => {
    await put('company/decisions/pending/D-030-broken.md', '제목 없는 카드\n')
    await put(P, CARD)
    await put(
      'company/decisions/pending/D-031-big.md',
      `# D-031: 큼\n${'x'.repeat(1024 * 1024 + 10)}`
    )
    await writeFile(join(outside, 'D-032-x.md'), CARD)
    await symlink(join(outside, 'D-032-x.md'), join(dir, 'company/decisions/pending/D-032-x.md'))
    const r = await (await handlers()).listDecisions(undefined)
    expect(r.ok && r.value.items.map((d) => d.id)).toEqual(['D-020'])
    const un = r.ok ? r.value.unreadable : []
    expect(un).toEqual(
      expect.arrayContaining([
        { path: 'company/decisions/pending/D-030-broken.md', reason: 'unreadable' },
        { path: 'company/decisions/pending/D-031-big.md', reason: 'too-large' },
        { path: 'company/decisions/pending/D-032-x.md', reason: 'unreadable' }
      ])
    )
    expect(Object.keys(un[0]).sort()).toEqual(['path', 'reason'])
    expect(JSON.stringify(r)).not.toContain(dir)
  })

  it('lists done and hides the pending twin as duplicate', async () => {
    await put(P, CARD)
    await put(D, withDecisionResolved(CARD, 'A', ''))
    const h = await handlers()
    const all = await h.listDecisions(undefined)
    expect(all).toMatchObject({
      ok: true,
      value: {
        items: [{ id: 'D-020', status: 'done' }],
        unreadable: [{ path: P, reason: 'duplicate' }]
      }
    })
    const pendingOnly = await h.listDecisions('pending')
    expect(pendingOnly).toMatchObject({ ok: true, value: { items: [] } })
  })

  it('treats two cards with the same id in one folder as duplicates', async () => {
    await put('company/decisions/pending/D-020-a.md', CARD)
    await put('company/decisions/pending/D-020-b.md', CARD)
    const r = await (await handlers()).listDecisions(undefined)
    expect(r).toMatchObject({
      ok: true,
      value: {
        items: [{ id: 'D-020' }],
        unreadable: [{ path: 'company/decisions/pending/D-020-b.md', reason: 'duplicate' }]
      }
    })
  })
})

describe('crash leftovers: card present in both pending and done', () => {
  it('same content: retry cleans the pending twin and reports conflict (not stuck)', async () => {
    await put(P, CARD)
    await put(D, withDecisionResolved(CARD, 'A', 'x'))
    const h = await handlers()
    expect(await h.resolveDecision({ id: 'D-020', choice: 'B' })).toMatchObject({
      ok: false,
      code: 'conflict'
    })
    expect(existsSync(join(dir, P))).toBe(false)
    expect(await readFile(join(dir, D), 'utf8')).toContain('- 선택: A')
    expect(await h.listDecisions(undefined)).toMatchObject({
      ok: true,
      value: { items: [{ chosen: 'A' }], unreadable: [] }
    })
  })

  it('different content: still cleans up and keeps the recorded decision', async () => {
    await put(P, CARD + '\n## 추가\n나중에 편집됨\n')
    await put(D, withDecisionResolved(CARD, 'B', ''))
    const h = await handlers()
    expect(await h.resolveDecision({ id: 'D-020', choice: 'A' })).toMatchObject({
      code: 'conflict'
    })
    expect(existsSync(join(dir, P))).toBe(false)
    expect(await readFile(join(dir, D), 'utf8')).toContain('- 선택: B')
  })

  it('done twin without a recorded choice: nothing is deleted', async () => {
    await put(P, CARD)
    await put(D, CARD.replace('pending', 'done'))
    const h = await handlers()
    expect(await h.resolveDecision({ id: 'D-020', choice: 'A' })).toMatchObject({
      code: 'conflict'
    })
    expect(existsSync(join(dir, P))).toBe(true)
  })

  it('different file names with the same id are not deleted', async () => {
    await put('company/decisions/pending/D-020-a.md', CARD)
    await put('company/decisions/done/D-020-b.md', withDecisionResolved(CARD, 'A', ''))
    const h = await handlers()
    expect(await h.resolveDecision({ id: 'D-020', choice: 'B' })).toMatchObject({
      code: 'conflict'
    })
    expect(existsSync(join(dir, 'company/decisions/pending/D-020-a.md'))).toBe(true)
  })
})

describe('symlink targets', () => {
  it('refuses to resolve when the done folder is a symlink', async () => {
    await put(P, CARD)
    await mkdir(join(dir, 'company/decisions'), { recursive: true })
    await symlink(outside, join(dir, 'company/decisions/done'))
    const r = await (await handlers()).resolveDecision({ id: 'D-020', choice: 'A' })
    expect(r).toMatchObject({ ok: false })
    expect(await readdir(outside)).toEqual([])
    expect(await readFile(join(dir, P), 'utf8')).toBe(CARD)
  })

  it('does not resolve a card that is itself a symlink', async () => {
    await writeFile(join(outside, 'D-020-t.md'), CARD)
    await mkdir(join(dir, 'company/decisions/pending'), { recursive: true })
    await symlink(join(outside, 'D-020-t.md'), join(dir, P))
    const r = await (await handlers()).resolveDecision({ id: 'D-020', choice: 'A' })
    expect(r).toMatchObject({ ok: false, code: 'not-found' })
    expect(await readFile(join(outside, 'D-020-t.md'), 'utf8')).toBe(CARD)
    expect(await readdir(join(dir, 'company/decisions/done')).catch(() => [])).toEqual([])
  })
})
