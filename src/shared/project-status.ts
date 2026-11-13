/** 프로젝트별 티켓 현황 집계 (T-042). main 호출과 renderer 계산 모두에 쓰는 순수 함수다. */
import type { ProjectState } from './project'
import type { Ticket, TicketStatus } from './ticket'

export const RECENT_DONE_LIMIT = 5

/** 집계에 필요한 프로젝트 정보만 받는다 (`ProjectInfo`가 그대로 들어간다). */
export interface ProjectRef {
  id: string
  name: string
  state: ProjectState
  pmId: string | null
  pm: { id: string; name: string } | null
}

export interface StatusTicketRef {
  id: string
  title: string
}

export type ProjectStatusScope =
  /** 등록된 프로젝트 (보관됨 포함, `pmState`가 `archived`). */
  | { kind: 'project'; projectId: string; name: string }
  /** 프로젝트 줄이 없는 티켓. */
  | { kind: 'company' }
  /** 등록되지 않은 id를 가리키는 티켓. 오류가 아니다. */
  | { kind: 'unknown'; projectId: string }

export interface ProjectStatusSummary {
  scope: ProjectStatusScope
  counts: Record<TicketStatus, number>
  /** 최근 완료 (id 번호가 큰 순), 최대 `RECENT_DONE_LIMIT`건. */
  recentDone: StatusTicketRef[]
  /** 이 범위 티켓을 가리키는 pending 결정 수. */
  pendingDecisions: number
  /** project 범위만 값이 있다. company/unknown은 null. */
  pmState: ProjectState | null
  pm: { id: string; name: string } | null
}

export interface CompanyStatus {
  /** 등록 프로젝트(등록 순) → 회사 공통 → 미확인 프로젝트(id 순). 티켓이 없는 활성 프로젝트도 포함하고, 티켓 없는 보관·공통·미확인은 뺀다. */
  summaries: ProjectStatusSummary[]
  total: { counts: Record<TicketStatus, number>; pendingDecisions: number }
  /** 활성이면서 PM이 필요한 프로젝트 수 (회사 합계 카드용). */
  pmRequiredCount: number
}

const emptyCounts = (): Record<TicketStatus, number> => ({
  backlog: 0,
  'in-progress': 0,
  done: 0
})

const numOf = (id: string): number => Number(/^T-(\d+)$/.exec(id)?.[1] ?? 0)

/**
 * @param tickets 전체 티켓
 * @param pendingDecisionTicketIds pending 결정 카드의 `ticketId`들 (null은 제외하고 넘겨도 된다). 티켓에 속하지 않는 결정은 합계에도 세지 않는다.
 */
export function summarizeProjects(
  tickets: readonly Pick<Ticket, 'id' | 'title' | 'status' | 'projectId'>[],
  projects: readonly ProjectRef[],
  pendingDecisionTicketIds: readonly (string | null)[]
): CompanyStatus {
  const byKey = new Map<string, ProjectStatusSummary>()
  const registered = new Set(projects.map((p) => p.id))
  const keyOf = (t: { projectId?: string | null }): string => t.projectId ?? ''
  const make = (scope: ProjectStatusScope, p: ProjectRef | null): ProjectStatusSummary => ({
    scope,
    counts: emptyCounts(),
    recentDone: [],
    pendingDecisions: 0,
    pmState: p?.state ?? null,
    pm: p?.pm ?? null
  })
  const get = (key: string): ProjectStatusSummary => {
    let s = byKey.get(key)
    if (!s) {
      s = make(key === '' ? { kind: 'company' } : { kind: 'unknown', projectId: key }, null)
      byKey.set(key, s)
    }
    return s
  }
  for (const p of projects)
    byKey.set(p.id, make({ kind: 'project', projectId: p.id, name: p.name }, p))

  const keyByTicket = new Map<string, string>()
  const done: Ticket['id'][] = []
  const titles = new Map<string, string>()
  for (const t of tickets) {
    const key = keyOf(t)
    keyByTicket.set(t.id, key)
    get(key).counts[t.status]++
    if (t.status === 'done') {
      done.push(t.id)
      titles.set(t.id, t.title)
    }
  }
  done.sort((a, b) => numOf(b) - numOf(a))
  for (const id of done) {
    const s = get(keyByTicket.get(id) ?? '')
    if (s.recentDone.length < RECENT_DONE_LIMIT)
      s.recentDone.push({ id, title: titles.get(id) ?? '' })
  }
  let pendingTotal = 0
  for (const tid of pendingDecisionTicketIds) {
    const key = tid === null ? undefined : keyByTicket.get(tid)
    if (key === undefined) continue
    get(key).pendingDecisions++
    pendingTotal++
  }

  const total = emptyCounts()
  const summaries: ProjectStatusSummary[] = []
  const push = (s: ProjectStatusSummary): void => {
    const n = s.counts.backlog + s.counts['in-progress'] + s.counts.done
    for (const k of Object.keys(total) as TicketStatus[]) total[k] += s.counts[k]
    if (n > 0 || (s.scope.kind === 'project' && s.pmState !== 'archived')) summaries.push(s)
  }
  for (const p of projects) push(byKey.get(p.id) as ProjectStatusSummary)
  const company = byKey.get('')
  if (company) push(company)
  const unknown = [...byKey.entries()]
    .filter(([k]) => k !== '' && !registered.has(k))
    .sort(([a], [b]) => a.localeCompare(b))
  for (const [, s] of unknown) push(s)

  return {
    summaries,
    total: { counts: total, pendingDecisions: pendingTotal },
    pmRequiredCount: projects.filter((p) => p.state === 'pm-required').length
  }
}
