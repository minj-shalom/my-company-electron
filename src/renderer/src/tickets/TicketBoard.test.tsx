import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Ticket } from '../../../shared/ticket'
import { createMockTicketApi, parseTicketScenario } from '../mock-tickets'
import { TicketBoard } from './TicketBoard'
import type { TicketsState } from './ticket-view'

const t = (id: string, over: Partial<Ticket> = {}): Ticket => ({
  id,
  title: `제목 ${id}`,
  status: 'backlog',
  assignee: null,
  department: '개발팀',
  body: '<script>alert(1)</script>\n두 번째 줄',
  ...over
})

const board = (state: TicketsState): string =>
  renderToStaticMarkup(<TicketBoard state={state} refresh={async () => {}} markMoved={() => {}} />)
const ready = (
  items: Ticket[],
  over: Partial<Extract<TicketsState, { kind: 'ready' }>> = {}
): TicketsState => ({
  kind: 'ready',
  items,
  unreadable: [],
  hired: ['cto'],
  stale: false,
  ...over
})

describe('TicketBoard states', () => {
  it('renders loading, error and empty', () => {
    expect(board({ kind: 'loading' })).toContain('불러오고 있어요')
    const err = board({ kind: 'error', message: '티켓을 불러오지 못했어요.' })
    expect(err).toContain('role="alert"')
    expect(err).toContain('다시 시도')
    expect(board(ready([]))).toContain('아직 티켓이 없어요')
  })
  it('renders three labelled columns with list semantics and counts', () => {
    const html = board(ready([t('T-001'), t('T-002', { status: 'done', assignee: 'cto' })]))
    expect(html).toContain('aria-labelledby')
    for (const label of ['대기', '진행 중', '완료']) expect(html).toContain(label)
    expect(html).toContain('<ul class="tlist"')
    expect(html).toContain('이 열에 티켓이 없어요')
    expect(html).toContain('aria-label="부서 필터"')
    expect(html).toContain('aria-label="담당 필터"')
  })
  it('shows status badges as non-errors and skips the missing check without an org', () => {
    const items = [t('T-001'), t('T-002', { assignee: 'pm' }), t('T-003', { assignee: 'cto' })]
    const withOrg = board(ready(items))
    expect(withOrg).toContain('담당 없음')
    expect(withOrg).toContain('담당 직원 없음 (채용 필요)')
    expect(withOrg).not.toContain('role="alert"')
    const noOrg = board(ready(items, { hired: null }))
    expect(noOrg).not.toContain('담당 직원 없음')
    expect(noOrg).toContain('담당 pm')
  })
  it('escapes ticket text and shows the unreadable banner with fixed reasons', () => {
    const html = board(
      ready([t('T-001', { title: '<img src=x onerror=alert(1)>' })], {
        unreadable: [
          { path: 'company/tickets/backlog/T-9-a.md', reason: 'duplicate' },
          { path: 'company/tickets/done/T-8-b.md', reason: 'too-large' }
        ]
      })
    )
    expect(html).not.toContain('<img')
    expect(html).toContain('읽지 못한 티켓 2건')
    expect(html).toContain('company/tickets/backlog/T-9-a.md')
    expect(html).toContain('같은 번호의 티켓이')
  })
  it('shows the stale notice and keeps the list', () => {
    const html = board(ready([t('T-001')], { stale: true }))
    expect(html).toContain('이전 목록')
    expect(html).toContain('제목 T-001')
  })
})

describe('mock tickets', () => {
  it('parses the scenario with a safe default', () => {
    expect(parseTicketScenario('?mock-tickets=many')).toBe('many')
    expect(parseTicketScenario('?mock-tickets=zzz')).toBe('samples')
    expect(parseTicketScenario('')).toBe('samples')
  })
  it('covers each scenario', async () => {
    expect(await createMockTicketApi('empty').api.listTickets()).toMatchObject({
      value: { items: [] }
    })
    expect(await createMockTicketApi('error').api.listTickets()).toMatchObject({ ok: false })
    const na = await createMockTicketApi('noassignee').api.listTickets()
    expect(
      na.ok && na.value.unreadable.length > 0 && na.value.items.some((x) => x.assignee === null)
    ).toBe(true)
    const c = createMockTicketApi('conflict').api
    expect(await c.moveTicket({ id: 'T-001', to: 'done' })).toMatchObject({ code: 'conflict' })
    const m = createMockTicketApi('many').api
    expect(await m.moveTicket({ id: 'T-001', to: 'done' })).toMatchObject({ ok: true })
  })
})
