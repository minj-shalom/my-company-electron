import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Decision } from '../../../shared/decision'
import type { ProjectInfo } from '../../../shared/project'
import type { Ticket } from '../../../shared/ticket'
import type { DecisionsState } from '../decisions/decision-view'
import type { ProjectsLoad } from '../projects/project-model'
import type { TicketsState } from '../tickets/ticket-view'
import { ProjectStatusView } from './ProjectStatusView'
import { buildStatusView } from './status-model'

const proj = (id: string, over: Partial<ProjectInfo> = {}): ProjectInfo => ({
  id,
  name: `프로젝트 ${id}`,
  path: `/x/${id}`,
  type: 'development',
  devCommand: null,
  defaultBranch: null,
  status: 'active',
  pmId: 'pm',
  pm: { id: 'pm', name: '김피엠' },
  state: 'ready',
  git: { status: 'ok', branch: 'develop', dirty: false },
  ...over
})
const t = (n: number, status: Ticket['status'], projectId?: string | null): Ticket => ({
  id: `T-00${n}`,
  title: `<b>제목 ${n}</b>`,
  status,
  assignee: null,
  department: null,
  body: '',
  ...(projectId === undefined ? {} : { projectId })
})
const tickets = (items: Ticket[]): TicketsState => ({
  kind: 'ready',
  items,
  unreadable: [],
  hired: null,
  stale: false
})
const projects = (items: ProjectInfo[]): ProjectsLoad => ({
  kind: 'ready',
  list: { items, format: 'blocks', unreadable: [] },
  pms: []
})
const decisions = (ticketIds: (string | null)[]): DecisionsState => ({
  kind: 'ready',
  items: ticketIds.map((ticketId, i): Decision => ({
    id: `D-00${i}`,
    title: 'd',
    status: 'pending',
    ticketId,
    question: '',
    options: [],
    recommended: null,
    chosen: null,
    memo: ''
  })),
  unreadable: [],
  stale: false
})
const noop = (): void => {}
const render = (view: ReturnType<typeof buildStatusView>, current: string | null = null): string =>
  renderToStaticMarkup(
    <ProjectStatusView
      view={view}
      current={current}
      onRetry={noop}
      onAssignPm={noop}
      onViewTickets={noop}
    />
  )

describe('buildStatusView', () => {
  it('maps loading, error and empty', () => {
    expect(buildStatusView({ kind: 'loading' }, projects([]), decisions([])).kind).toBe('loading')
    expect(buildStatusView(tickets([]), { kind: 'loading' }, decisions([])).kind).toBe('loading')
    expect(buildStatusView({ kind: 'error', message: 'x' }, projects([]), decisions([])).kind).toBe(
      'error'
    )
    expect(buildStatusView(tickets([]), { kind: 'error', message: 'x' }, decisions([])).kind).toBe(
      'error'
    )
    expect(buildStatusView(tickets([]), projects([]), decisions([])).kind).toBe('empty')
  })
  it('keeps going when decisions are unavailable', () => {
    const v = buildStatusView(tickets([t(1, 'done', 'a')]), projects([proj('a')]), {
      kind: 'error',
      message: 'x'
    })
    expect(v.kind === 'ready' && v.decisionsKnown).toBe(false)
  })
})

describe('ProjectStatusView', () => {
  it('renders loading, error and empty states', () => {
    expect(render({ kind: 'loading' })).toContain('불러오고 있어요')
    const err = render({ kind: 'error', message: '현황을 불러오지 못했어요.' })
    expect(err).toContain('role="alert"')
    expect(err).toContain('다시 시도')
    expect(render({ kind: 'empty' })).toContain('아직 프로젝트도 티켓도 없어요')
  })
  it('renders cards, totals, PM warning and escapes ticket text', () => {
    const view = buildStatusView(
      tickets([
        t(1, 'done', 'a'),
        t(2, 'in-progress', 'a'),
        t(3, 'backlog', 'b'),
        t(4, 'backlog'),
        t(5, 'backlog', 'ghost')
      ]),
      projects([
        proj('a'),
        proj('b', { state: 'pm-required', pmId: null, pm: null }),
        proj('old', { status: 'archived', state: 'archived' })
      ]),
      decisions(['T-002', 'T-003'])
    )
    const html = render(view, 'a')
    expect(html).toContain('회사 전체')
    expect(html).toContain('프로젝트 a')
    expect(html).toContain('보는 중')
    expect(html).toContain('김피엠')
    expect(html).toContain('PM 필요')
    expect(html).toContain('aria-label="프로젝트 b PM 지정"')
    expect(html).toContain('회사 공통')
    expect(html).toContain('미확인 프로젝트 (ghost)')
    expect(html).toContain('2건')
    expect(html).toContain('&lt;b&gt;제목 1&lt;/b&gt;')
    expect(html).not.toContain('<b>제목')
    expect(html).not.toContain('프로젝트 old')
    expect(html).toContain('aria-label="프로젝트 a 티켓 보기"')
    expect(html).not.toContain('미확인 프로젝트 (ghost) 티켓 보기')
  })
  it('shows an unknown marker for decisions when they could not be read', () => {
    const view = buildStatusView(tickets([t(1, 'done', 'a')]), projects([proj('a')]), {
      kind: 'error',
      message: 'x'
    })
    expect(render(view)).toContain('확인 불가')
  })
})
