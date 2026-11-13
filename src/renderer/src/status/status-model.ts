import {
  summarizeProjects,
  type CompanyStatus,
  type ProjectStatusSummary
} from '../../../shared/project-status'
import type { DecisionsState } from '../decisions/decision-view'
import type { ProjectsLoad } from '../projects/project-model'
import { COMPANY_COMMON_LABEL, UNKNOWN_PROJECT_LABEL } from '../tickets/ticket-project'
import type { TicketsState } from '../tickets/ticket-view'

export type StatusView =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'empty' }
  | {
      kind: 'ready'
      status: CompanyStatus
      /** 결정 목록을 읽지 못하면 막힌 결정 수는 "확인 불가"로 보인다. */
      decisionsKnown: boolean
    }

const ERROR_TEXT = '현황을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.'

/** 티켓·프로젝트·결정 상태를 합쳐 화면 상태를 정한다. 집계는 shared의 순수 함수가 한다. */
export function buildStatusView(
  tickets: TicketsState,
  projects: ProjectsLoad,
  decisions: DecisionsState
): StatusView {
  if (tickets.kind === 'error' || projects.kind === 'error')
    return { kind: 'error', message: ERROR_TEXT }
  if (tickets.kind === 'loading' || projects.kind === 'loading') return { kind: 'loading' }
  const pending =
    decisions.kind === 'ready'
      ? decisions.items.filter((d) => d.status === 'pending').map((d) => d.ticketId)
      : []
  const status = summarizeProjects(tickets.items, projects.list.items, pending)
  if (status.summaries.length === 0) return { kind: 'empty' }
  return { kind: 'ready', status, decisionsKnown: decisions.kind === 'ready' }
}

export function scopeTitle(s: ProjectStatusSummary): string {
  switch (s.scope.kind) {
    case 'project':
      return s.scope.name
    case 'company':
      return COMPANY_COMMON_LABEL
    case 'unknown':
      return `${UNKNOWN_PROJECT_LABEL} (${s.scope.projectId})`
  }
}

/** 티켓 보드의 보기 범위로 옮길 수 있는 카드만 값을 돌려준다 (활성 프로젝트, 회사 공통). */
export function scopeKey(s: ProjectStatusSummary): string | null {
  if (s.scope.kind === 'company') return ''
  if (s.scope.kind === 'project' && s.pmState !== 'archived') return s.scope.projectId
  return null
}

export function isCurrent(s: ProjectStatusSummary, current: string | null): boolean {
  return current !== null && scopeKey(s) === current
}
