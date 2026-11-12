import { describe, expect, it } from 'vitest'
import type { OrgSnapshot } from '../../../shared/org'
import type { Ticket } from '../../../shared/ticket'
import {
  applyFilters,
  applyMoved,
  assigneeBadge,
  assigneeOptions,
  canMove,
  departmentOptions,
  groupByStatus,
  hiredIds,
  loadTicketState,
  mergeRefresh,
  moveErrorText,
  moveTargets,
  NO_FILTERS,
  shouldRefreshAfterMoveError,
  ticketUnreadableText,
  type TicketsState
} from './ticket-view'

const t = (id: string, over: Partial<Ticket> = {}): Ticket => ({
  id,
  title: id,
  status: 'backlog',
  assignee: null,
  department: null,
  body: '',
  ...over
})

describe('groupByStatus', () => {
  it('sorts columns and drops unknown statuses', () => {
    const g = groupByStatus([
      t('T-010'),
      t('T-002'),
      t('T-003', { status: 'done' }),
      t('T-011', { status: 'done' }),
      t('T-020', { status: 'weird' as never })
    ])
    expect(g.backlog.map((x) => x.id)).toEqual(['T-002', 'T-010'])
    expect(g.done.map((x) => x.id)).toEqual(['T-011', 'T-003'])
    expect(g['in-progress']).toEqual([])
  })
})

describe('assigneeBadge', () => {
  const hired = new Set(['cto'])
  it('distinguishes none, missing and hired', () => {
    expect(assigneeBadge(t('T-1', { assignee: null }), hired)).toBe('none')
    expect(assigneeBadge(t('T-1', { assignee: '  ' }), hired)).toBe('none')
    expect(assigneeBadge(t('T-1', { assignee: 'pm' }), hired)).toBe('missing')
    expect(assigneeBadge(t('T-1', { assignee: 'cto' }), hired)).toBeNull()
  })
  it('skips the missing check when the org is unavailable', () => {
    expect(assigneeBadge(t('T-1', { assignee: 'pm' }), null)).toBeNull()
    expect(assigneeBadge(t('T-1', { assignee: null }), null)).toBe('none')
  })
})

describe('hiredIds', () => {
  const snap = (members: unknown[], issues: unknown[] = []): OrgSnapshot =>
    ({ org: { members, issues }, agents: [] }) as unknown as OrgSnapshot
  it('collects agent ids only', () => {
    expect(
      hiredIds(
        snap([
          { kind: 'human', agentId: null },
          { kind: 'agent', agentId: 'cto' }
        ])
      )
    ).toEqual(['cto'])
  })
  it('returns null when the org table is unusable', () => {
    expect(hiredIds(snap([], [{ code: 'missing-org' }]))).toBeNull()
    expect(hiredIds(snap([], [{ code: 'cycle' }]))).toEqual([])
  })
})

describe('filters', () => {
  const items = [
    t('T-1', { department: '개발팀', assignee: 'developer' }),
    t('T-2', { department: '개발팀' }),
    t('T-3', { department: '재무', assignee: 'cfo' }),
    t('T-4')
  ]
  it('filters by department and by "no assignee"', () => {
    expect(applyFilters(items, { department: '개발팀', assignee: null }).map((x) => x.id)).toEqual([
      'T-1',
      'T-2'
    ])
    expect(applyFilters(items, { department: null, assignee: '' }).map((x) => x.id)).toEqual([
      'T-2',
      'T-4'
    ])
    expect(applyFilters(items, NO_FILTERS)).toHaveLength(4)
  })
  it('counts chips against the other filter and puts "no assignee" first', () => {
    const a = assigneeOptions(items, { department: '개발팀', assignee: null })
    expect(a.map((o) => [o.label, o.count])).toEqual([
      ['전체', 2],
      ['담당 없음', 1],
      ['cfo', 0],
      ['developer', 1]
    ])
    const d = departmentOptions(items, { department: null, assignee: '' })
    expect(d.map((o) => [o.label, o.count])).toEqual([
      ['전체', 2],
      ['개발팀', 1],
      ['재무', 0],
      ['부서 없음', 1]
    ])
  })
  it('keeps a selected value that no longer exists', () => {
    expect(
      departmentOptions([], { department: '없는팀', assignee: null }).map((o) => o.label)
    ).toEqual(['전체', '없는팀'])
  })
})

describe('move rules', () => {
  it('offers the other two columns', () => {
    expect(moveTargets('backlog')).toEqual(['in-progress', 'done'])
    expect(moveTargets('done')).toEqual(['backlog', 'in-progress'])
  })
  it('rejects same-column and unknown targets', () => {
    expect(canMove('backlog', 'done')).toBe(true)
    expect(canMove('backlog', 'backlog')).toBe(false)
    expect(canMove('backlog', 'x')).toBe(false)
  })
  it('maps codes to fixed texts without server messages', () => {
    for (const c of ['conflict', 'not-found', 'invalid-request', 'internal', 'no-company'] as const)
      expect(moveErrorText(c)).not.toContain('/')
    expect(moveErrorText('conflict')).not.toBe(moveErrorText('internal'))
    expect(shouldRefreshAfterMoveError('conflict')).toBe(true)
    expect(shouldRefreshAfterMoveError('not-found')).toBe(true)
    expect(shouldRefreshAfterMoveError('invalid-request')).toBe(true)
    expect(shouldRefreshAfterMoveError('internal')).toBe(false)
  })
  it('texts unreadable reasons', () => {
    expect(ticketUnreadableText('duplicate')).toContain('티켓')
    expect(ticketUnreadableText('zzz')).toContain('읽을 수 없는')
  })
})

describe('state', () => {
  const ready = (items: Ticket[]): TicketsState => ({
    kind: 'ready',
    items,
    unreadable: [],
    hired: null,
    stale: false
  })
  it('keeps the previous list as stale when a refresh fails', () => {
    const prev = ready([t('T-1')])
    expect(mergeRefresh(prev, { kind: 'error', message: 'x' })).toMatchObject({
      kind: 'ready',
      stale: true
    })
    expect(mergeRefresh({ kind: 'loading' }, { kind: 'error', message: 'x' }).kind).toBe('error')
  })
  it('applies a move without touching the body', () => {
    const next = applyMoved(ready([t('T-1', { body: 'b' })]), { id: 'T-1', status: 'done' })
    expect(next.kind === 'ready' && next.items[0]).toMatchObject({ status: 'done', body: 'b' })
  })
  it('loads tickets and tolerates an org failure', async () => {
    const s = await loadTicketState({
      listTickets: async () => ({ ok: true, value: { items: [t('T-1')], unreadable: [] } }),
      getOrg: async () => ({ ok: false, code: 'no-company', message: 'x' })
    })
    expect(s).toMatchObject({ kind: 'ready', hired: null })
  })
  it('reports a load error with a fixed message', async () => {
    const s = await loadTicketState({
      listTickets: async () => ({ ok: false, code: 'internal', message: '/Users/secret/path' }),
      getOrg: async () => {
        throw new Error('x')
      }
    })
    expect(s.kind === 'error' && s.message).not.toContain('secret')
    const thrown = await loadTicketState({
      listTickets: async () => {
        throw new Error('x')
      },
      getOrg: async () => ({ ok: false, code: 'internal', message: '' })
    })
    expect(thrown.kind).toBe('error')
  })
})
