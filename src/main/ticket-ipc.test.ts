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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_TICKET_BODY_CHARS, type Ticket, type TicketStatus } from '../shared/ticket'
import { CompanyContext } from './company/company-context'
import { createDomainHandlers } from './domain-ipc'
import { ProviderService } from './providers/provider-service'
import { SafeFs } from './repository/safe-fs'
import { createWeeklyLimitsStore } from './settings/weekly-limits-store'

const FIXTURES = join(__dirname, 'repository', 'fixtures', 'tickets')

let dir: string
let outside: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mc-tk-'))
  outside = await mkdtemp(join(tmpdir(), 'mc-tk-out-'))
  await writeFile(join(dir, 'CLAUDE.md'), '# c\n')
  await put('company/org.md', '# 조직도\n')
})
afterEach(async () => {
  vi.restoreAllMocks()
  await rm(dir, { recursive: true, force: true })
  await rm(outside, { recursive: true, force: true })
})

async function put(rel: string, content: string): Promise<void> {
  const abs = join(dir, rel)
  await mkdir(dirname(abs), { recursive: true })
  await writeFile(abs, content)
}
async function fixture(name: string, status: TicketStatus): Promise<void> {
  const abs = join(dir, 'company/tickets', status, name)
  await mkdir(dirname(abs), { recursive: true })
  await copyFile(join(FIXTURES, name), abs)
}
const at = (status: TicketStatus, name: string): string =>
  join(dir, 'company/tickets', status, name)

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
type H = Awaited<ReturnType<typeof handlers>>

const list = async (h: H, s?: unknown): Promise<Ticket[]> => {
  const r = await h.listTickets(s)
  if (!r.ok) throw new Error(r.code)
  return r.value.items
}

const ticket = (n: number, extra = '', body = ''): string =>
  `# T-${String(n).padStart(3, '0')}: 테스트 티켓\n\n- **상태:** backlog\n${extra}\n## 목표\n${body}\n`

describe('ticket:list / ticket:get', () => {
  it('requires an open company', async () => {
    const h = await handlers(false)
    expect(await h.listTickets(undefined)).toMatchObject({ ok: false, code: 'no-company' })
    expect(await h.getTicket('T-001')).toMatchObject({ ok: false, code: 'no-company' })
    expect(await h.moveTicket({ id: 'T-001', to: 'done' })).toMatchObject({
      ok: false,
      code: 'no-company'
    })
  })

  it('parses real tickets copied from the company folder; the folder is the status', async () => {
    await fixture('T-012-ticket-board.md', 'in-progress')
    await fixture('T-013-run-log-view.md', 'backlog')
    await fixture('T-051-hr-team-default-org.md', 'backlog')
    // 파일 안의 상태 줄은 backlog로 남아 있지만 폴더가 done이다.
    await fixture('T-034-main-handlers-wiring.md', 'done')
    const h = await handlers()
    const all = await list(h)
    expect(all.map((t) => [t.id, t.status, t.assignee, t.department])).toEqual([
      ['T-012', 'in-progress', 'ui-dev', '개발팀'],
      ['T-013', 'backlog', 'ui-dev', '개발팀'],
      ['T-034', 'done', 'electron-main-dev', '개발팀'],
      ['T-051', 'backlog', 'electron-main-dev', '개발팀']
    ])
    expect(all[0].title).toBe('티켓 보드 UI')
    expect((await list(h, 'backlog')).map((t) => t.id)).toEqual(['T-013', 'T-051'])
    expect((await h.getTicket('T-034')).ok).toBe(true)
  })

  it('returns tickets with no assignee, no department, or an assignee who does not exist as normal', async () => {
    await put('company/tickets/backlog/T-100-a.md', '# T-100: 담당 없음\n\n- **상태:** backlog\n')
    await put('company/tickets/backlog/T-101-b.md', '# T-101: 빈 담당\n- **담당:**\n- **부서:**\n')
    await put(
      'company/tickets/backlog/T-102-c.md',
      '# T-102: 없는 직원\n- **담당:** pm\n- **부서:** 기획팀\n'
    )
    await put('company/tickets/backlog/T-103-d.md', '# T-103: 괄호\n- **담당:** (미정)\n')
    const h = await handlers()
    const all = await list(h)
    expect(all.map((t) => [t.id, t.assignee, t.department ?? null])).toEqual([
      ['T-100', null, null],
      ['T-101', null, null],
      ['T-102', 'pm', '기획팀'],
      ['T-103', null, null]
    ])
    const r = await h.listTickets(undefined)
    expect(r.ok && r.value.unreadable).toEqual([])
  })

  it('rejects bad status and id values', async () => {
    const h = await handlers()
    for (const bad of ['all', '', 1, null, {}, '../done', 'Done'])
      expect(await h.listTickets(bad)).toMatchObject({ ok: false, code: 'invalid-request' })
    for (const bad of [
      'T-',
      'T-1234567',
      't-1',
      '../../etc/passwd',
      'T-1\n',
      'T-1/x',
      5,
      null,
      {},
      ''
    ])
      expect(await h.getTicket(bad)).toMatchObject({ ok: false, code: 'invalid-request' })
    expect(await h.getTicket('T-404')).toMatchObject({ ok: false, code: 'not-found' })
  })

  it('keeps listing when a ticket is corrupt and reports it as unreadable', async () => {
    await fixture('T-013-run-log-view.md', 'backlog')
    await put('company/tickets/backlog/T-030-broken.md', '---\ntitle: [oops\n---\n')
    await put('company/tickets/backlog/T-031-notitle.md', '본문만 있음\n')
    await put('company/tickets/backlog/big.md', 'x') // 규칙 밖 파일명
    await put('company/tickets/done/T-032-huge.md', 'x'.repeat(1024 * 1024 + 1))
    await writeFile(join(outside, 'T-033-x.md'), ticket(33))
    await symlink(join(outside, 'T-033-x.md'), at('backlog', 'T-033-x.md'))
    const h = await handlers()
    const r = await h.listTickets(undefined)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.items.map((t) => t.id)).toEqual(['T-013'])
    const byPath = Object.fromEntries(r.value.unreadable.map((u) => [u.path, u.reason]))
    expect(byPath['company/tickets/backlog/T-030-broken.md']).toBe('unreadable')
    expect(byPath['company/tickets/backlog/T-031-notitle.md']).toBe('unreadable')
    expect(byPath['company/tickets/backlog/T-033-x.md']).toBe('unreadable')
    expect(byPath['company/tickets/done/T-032-huge.md']).toBe('too-large')
    // 오류 원문이나 절대 경로가 renderer로 가지 않는다.
    const wire = JSON.stringify(r.value)
    expect(wire).not.toContain(dir)
    expect(wire).not.toContain(outside)
    for (const u of r.value.unreadable) expect(Object.keys(u).sort()).toEqual(['path', 'reason'])
  })

  it('hides a duplicate id left by an interrupted move and reports it', async () => {
    await put('company/tickets/in-progress/T-040-x.md', ticket(40))
    await put('company/tickets/done/T-040-x.md', ticket(40))
    const h = await handlers()
    const r = await h.listTickets(undefined)
    if (!r.ok) throw new Error(r.code)
    expect(r.value.items.map((t) => t.status)).toEqual(['done'])
    expect(r.value.unreadable).toEqual([
      { path: 'company/tickets/in-progress/T-040-x.md', reason: 'duplicate' }
    ])
  })

  it('returns an empty list when the ticket folders do not exist', async () => {
    expect(await list(await handlers())).toEqual([])
  })

  it('truncates very long bodies and marks them', async () => {
    await put('company/tickets/backlog/T-050-long.md', ticket(50, '', 'a'.repeat(300_000)))
    await put('company/tickets/backlog/T-051-short.md', ticket(51, '', 'b'))
    const h = await handlers()
    const [long, short] = await list(h)
    expect(long.body.length).toBe(MAX_TICKET_BODY_CHARS)
    expect(long.bodyTruncated).toBe(true)
    expect(short.bodyTruncated).toBe(false)
    const got = await h.getTicket('T-050')
    expect(got.ok && got.value.bodyTruncated).toBe(true)
    // 잘라도 원본 파일은 그대로다.
    expect((await readFile(at('backlog', 'T-050-long.md'), 'utf8')).length).toBeGreaterThan(300_000)
  })

  it('does not cut a surrogate pair in half when truncating', async () => {
    await put('company/tickets/backlog/T-052-emoji.md', '# T-052: e\n' + '😀'.repeat(150_000))
    const [t] = await list(await handlers())
    expect(t.bodyTruncated).toBe(true)
    const last = t.body.charCodeAt(t.body.length - 1)
    expect(last >= 0xd800 && last <= 0xdbff).toBe(false)
  })

  it('handles a 1MB ticket within 3 seconds', async () => {
    const body = 'x'.repeat(1000) + '\n'
    await put(
      'company/tickets/backlog/T-060-big.md',
      ticket(60, '', body.repeat(Math.floor((1024 * 1024 - 200) / body.length)))
    )
    const h = await handlers()
    const t0 = Date.now()
    expect((await list(h)).length).toBe(1)
    expect((await h.getTicket('T-060')).ok).toBe(true)
    expect((await h.moveTicket({ id: 'T-060', to: 'done' })).ok).toBe(true)
    expect(Date.now() - t0).toBeLessThan(3000)
  })

  it('treats a symlinked ticket folder as unreadable instead of following it', async () => {
    await writeFile(join(outside, 'T-070-x.md'), ticket(70))
    await mkdir(join(dir, 'company/tickets'), { recursive: true })
    await symlink(outside, join(dir, 'company/tickets/backlog'))
    await fixture('T-012-ticket-board.md', 'in-progress')
    const h = await handlers()
    const r = await h.listTickets(undefined)
    if (!r.ok) throw new Error(r.code)
    expect(r.value.items.map((t) => t.id)).toEqual(['T-012'])
    expect(r.value.unreadable.map((u) => u.path)).toEqual(['company/tickets/backlog'])
    // 링크 폴더 밖으로 이동도 쓰기도 일어나지 않는다.
    expect(await h.moveTicket({ id: 'T-012', to: 'backlog' })).toMatchObject({ ok: false })
    expect(existsSync(at('in-progress', 'T-012-ticket-board.md'))).toBe(true)
    expect(await readdir(outside)).toEqual(['T-070-x.md'])
  })
})

describe('ticket:move', () => {
  it('moves the file between all three states and rewrites the status line', async () => {
    await fixture('T-034-main-handlers-wiring.md', 'done')
    const h = await handlers()
    for (const to of ['backlog', 'in-progress', 'done', 'in-progress', 'backlog'] as const) {
      const r = await h.moveTicket({ id: 'T-034', to })
      expect(r).toMatchObject({ ok: true, value: { id: 'T-034', status: to } })
      for (const s of ['backlog', 'in-progress', 'done'] as const)
        expect(existsSync(at(s, 'T-034-main-handlers-wiring.md'))).toBe(s === to)
      expect(await readFile(at(to, 'T-034-main-handlers-wiring.md'), 'utf8')).toContain(
        `- **상태:** ${to}\n`
      )
    }
    // 상태 줄 말고는 원본과 같다.
    const original = await readFile(join(FIXTURES, 'T-034-main-handlers-wiring.md'), 'utf8')
    expect(await readFile(at('backlog', 'T-034-main-handlers-wiring.md'), 'utf8')).toBe(original)
  })

  it('is idempotent when the ticket is already in the target state', async () => {
    await fixture('T-013-run-log-view.md', 'backlog')
    const h = await handlers()
    const before = await readFile(at('backlog', 'T-013-run-log-view.md'), 'utf8')
    expect(await h.moveTicket({ id: 'T-013', to: 'backlog' })).toMatchObject({
      ok: true,
      value: { status: 'backlog' }
    })
    expect(await readFile(at('backlog', 'T-013-run-log-view.md'), 'utf8')).toBe(before)
    const first = await h.moveTicket({ id: 'T-013', to: 'done' })
    const second = await h.moveTicket({ id: 'T-013', to: 'done' })
    expect(first.ok && second.ok).toBe(true)
    expect(await readdir(join(dir, 'company/tickets/done'))).toEqual(['T-013-run-log-view.md'])
  })

  it('serializes concurrent moves: no loss, no duplicates, a single final location', async () => {
    await fixture('T-013-run-log-view.md', 'backlog')
    const h = await handlers()
    const rs = await Promise.all([
      h.moveTicket({ id: 'T-013', to: 'done' }),
      h.moveTicket({ id: 'T-013', to: 'in-progress' }),
      h.moveTicket({ id: 'T-013', to: 'done' }),
      h.moveTicket({ id: 'T-013', to: 'backlog' }),
      h.moveTicket({ id: 'T-013', to: 'done' })
    ])
    expect(rs.every((r) => r.ok)).toBe(true)
    const homes = (
      await Promise.all(
        (['backlog', 'in-progress', 'done'] as const).map(async (s) =>
          existsSync(at(s, 'T-013-run-log-view.md')) ? s : null
        )
      )
    ).filter(Boolean)
    expect(homes).toEqual(['done'])
    expect(rs[4]).toMatchObject({ ok: true, value: { status: 'done' } })
    expect((await list(h)).length).toBe(1)
  })

  it('serializes concurrent moves of different tickets as well', async () => {
    for (const n of [1, 2, 3, 4]) await put(`company/tickets/backlog/T-00${n}-x.md`, ticket(n))
    const h = await handlers()
    const rs = await Promise.all(
      [1, 2, 3, 4].map((n) => h.moveTicket({ id: `T-00${n}`, to: 'in-progress' }))
    )
    expect(rs.every((r) => r.ok)).toBe(true)
    expect((await list(h, 'in-progress')).length).toBe(4)
  })

  it('conflicts when a different file already sits at the target, and changes nothing', async () => {
    await put('company/tickets/in-progress/T-005-loader.md', ticket(5))
    await put('company/tickets/done/T-005-loader.md', '# T-005: 다른 내용\n')
    const h = await handlers()
    const r = await h.moveTicket({ id: 'T-005', to: 'done' })
    expect(r).toMatchObject({ ok: false, code: 'conflict' })
    expect(await readFile(at('done', 'T-005-loader.md'), 'utf8')).toBe('# T-005: 다른 내용\n')
    expect(existsSync(at('in-progress', 'T-005-loader.md'))).toBe(true)
    if (!r.ok) expect(r.message).not.toContain('T-005-loader')
  })

  it('never overwrites a file that appears at the target between the check and the write', async () => {
    await put('company/tickets/backlog/T-006-race.md', ticket(6))
    const h = await handlers()
    const orig = SafeFs.prototype.writeText
    vi.spyOn(SafeFs.prototype, 'writeText').mockImplementationOnce(async function (
      this: SafeFs,
      rel,
      content,
      overwrite
    ) {
      // 에이전트가 같은 이름을 먼저 만든 상황을 흉내 낸다.
      await put('company/tickets/done/T-006-race.md', '# T-006: 에이전트가 만듦\n')
      return orig.call(this, rel, content, overwrite)
    })
    expect(await h.moveTicket({ id: 'T-006', to: 'done' })).toMatchObject({
      ok: false,
      code: 'conflict'
    })
    expect(await readFile(at('done', 'T-006-race.md'), 'utf8')).toBe('# T-006: 에이전트가 만듦\n')
    expect(existsSync(at('backlog', 'T-006-race.md'))).toBe(true)
  })

  it('rolls back when removing the old file fails mid-move', async () => {
    await put('company/tickets/in-progress/T-007-x.md', ticket(7))
    const h = await handlers()
    vi.spyOn(SafeFs.prototype, 'remove').mockRejectedValueOnce(
      Object.assign(new Error('EACCES: /secret/path'), { code: 'EACCES' })
    )
    const r = await h.moveTicket({ id: 'T-007', to: 'done' })
    expect(r).toMatchObject({ ok: false, code: 'internal', message: '요청을 처리하지 못했습니다.' })
    expect(existsSync(at('done', 'T-007-x.md'))).toBe(false)
    expect(await readFile(at('in-progress', 'T-007-x.md'), 'utf8')).toBe(ticket(7))
    expect(await readdir(join(dir, 'company/tickets/done'))).toEqual([])
    // 실패 뒤에도 큐가 막히지 않고 다음 이동이 된다.
    expect((await h.moveTicket({ id: 'T-007', to: 'done' })).ok).toBe(true)
  })

  it('leaves no temp file and keeps the source when the write itself fails', async () => {
    await put('company/tickets/backlog/T-008-x.md', ticket(8))
    const h = await handlers()
    vi.spyOn(SafeFs.prototype, 'writeText').mockRejectedValueOnce(new Error('ENOSPC'))
    expect(await h.moveTicket({ id: 'T-008', to: 'done' })).toMatchObject({ ok: false })
    expect(existsSync(at('backlog', 'T-008-x.md'))).toBe(true)
    expect(existsSync(join(dir, 'company/tickets/done'))).toBe(false)
  })

  it('recovers a half-finished move where the new file already has identical content', async () => {
    await put('company/tickets/in-progress/T-009-x.md', ticket(9))
    await put('company/tickets/done/T-009-x.md', ticket(9).replace('backlog', 'done'))
    const h = await handlers()
    expect(await h.moveTicket({ id: 'T-009', to: 'done' })).toMatchObject({ ok: true })
    expect(existsSync(at('in-progress', 'T-009-x.md'))).toBe(false)
  })

  it('refuses to move a ticket it cannot read, and keeps the file', async () => {
    await put('company/tickets/backlog/T-010-broken.md', '---\ntitle: [oops\n---\n')
    await put('company/tickets/backlog/T-011-notitle.md', '본문만\n')
    const h = await handlers()
    for (const id of ['T-010', 'T-011'])
      expect(await h.moveTicket({ id, to: 'done' })).toMatchObject({
        ok: false,
        code: 'invalid-request'
      })
    expect(existsSync(at('backlog', 'T-010-broken.md'))).toBe(true)
    expect(existsSync(at('backlog', 'T-011-notitle.md'))).toBe(true)
  })

  it('moves a ticket without a status line and keeps its content', async () => {
    await put('company/tickets/backlog/T-012-x.md', '# T-012: 줄 없음\n- **담당:** ui-dev\n')
    const h = await handlers()
    expect(await h.moveTicket({ id: 'T-012', to: 'done' })).toMatchObject({
      ok: true,
      value: { status: 'done', assignee: 'ui-dev' }
    })
    expect(await readFile(at('done', 'T-012-x.md'), 'utf8')).toBe(
      '# T-012: 줄 없음\n- **담당:** ui-dev\n'
    )
  })

  it('creates the target folder when it does not exist yet', async () => {
    await put('company/tickets/backlog/T-013-x.md', ticket(13))
    const h = await handlers()
    expect((await h.moveTicket({ id: 'T-013', to: 'done' })).ok).toBe(true)
  })

  it('does not follow a symlinked target folder', async () => {
    await put('company/tickets/backlog/T-014-x.md', ticket(14))
    await symlink(outside, join(dir, 'company/tickets/done'))
    const h = await handlers()
    expect(await h.moveTicket({ id: 'T-014', to: 'done' })).toMatchObject({
      ok: false,
      code: 'invalid-request'
    })
    expect(await readdir(outside)).toEqual([])
    expect(existsSync(at('backlog', 'T-014-x.md'))).toBe(true)
  })

  it('rejects malformed requests without touching any file', async () => {
    await put('company/tickets/backlog/T-015-x.md', ticket(15))
    const h = await handlers()
    const bad: unknown[] = [
      undefined,
      null,
      'T-015',
      [],
      42,
      {},
      { id: 'T-015' },
      { to: 'done' },
      { id: 'T-015', to: 'nope' },
      { id: 'T-015', to: '../done' },
      { id: 'T-015', to: 'Done' },
      { id: 'T-015', to: ['done'] },
      { id: 'T-015', to: { toString: () => 'done' } },
      { id: 'T-015', to: null },
      { id: '../T-015', to: 'done' },
      { id: 'T-015/..', to: 'done' },
      { id: 'T-015\n', to: 'done' },
      { id: 'T-0000015', to: 'done' },
      { id: 'T-', to: 'done' },
      { id: 15, to: 'done' },
      { id: ['T-015'], to: 'done' },
      { id: 'T-015\0', to: 'done' },
      { id: 'D-001', to: 'done' }
    ]
    for (const req of bad)
      expect(await h.moveTicket(req)).toMatchObject({ ok: false, code: 'invalid-request' })
    expect(await readdir(join(dir, 'company/tickets/backlog'))).toEqual(['T-015-x.md'])
    expect(existsSync(join(dir, 'company/tickets/done'))).toBe(false)
  })

  it('ignores extra fields and returns only fixed error messages', async () => {
    await put('company/tickets/backlog/T-016-x.md', ticket(16))
    const h = await handlers()
    expect(
      await h.moveTicket({ id: 'T-016', to: 'done', path: '/etc/passwd', overwrite: true })
    ).toMatchObject({ ok: true, value: { status: 'done' } })
    const nf = await h.moveTicket({ id: 'T-999', to: 'done' })
    expect(nf).toMatchObject({ ok: false, code: 'not-found', message: '티켓을 찾을 수 없습니다.' })
  })

  it('does not treat another id with the same prefix as the ticket (T-1 vs T-12)', async () => {
    await put('company/tickets/backlog/T-012-x.md', ticket(12))
    const h = await handlers()
    expect(await h.moveTicket({ id: 'T-1', to: 'done' })).toMatchObject({
      ok: false,
      code: 'not-found'
    })
    expect(existsSync(at('backlog', 'T-012-x.md'))).toBe(true)
  })
})
