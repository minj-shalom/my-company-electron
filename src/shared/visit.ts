/** CEO 방문 요약(T-043) 계약. 모두 읽기 전용 집계이며 카드 본문과 경로는 담지 않는다. */
import type { AuditSummary, KillSwitchState } from './gate'

export interface VisitItem {
  /** 보고서 id, 티켓 id(T-번호), 결정 카드 id(D-번호). */
  id: string
  title: string
  /** 소속 프로젝트 id. 알 수 없거나 회사 공통이면 null. */
  projectId: string | null
}

export interface VisitSummaryRequest {
  /** 지정하면 티켓 항목을 이 프로젝트로 좁힌다 (회사 공통 항목은 제외). */
  projectId?: string
}

export interface VisitSummary {
  /** 마지막 방문 시각(ISO 8601). 첫 방문이면 null이고 목록은 비어 있다. */
  since: string | null
  /** 이 요약을 만든 시각(ISO 8601). */
  until: string
  firstVisit: boolean
  /** 지난 방문 이후 새 틱 브리핑 보고서 (최신이 먼저, 최대 50건). */
  reports: VisitItem[]
  /** 지난 방문 이후 done으로 옮겨진 티켓 (최대 50건). */
  completedTickets: VisitItem[]
  /** 지난 방문 이후 새로 생긴 pending 결정 카드 (최대 50건). */
  newDecisions: VisitItem[]
  /** 지난 방문 이후 실패·시간 초과로 끝난 틱 브리핑 수. */
  failedTicks: number
  /** 자동 실행 요약(T-053). 읽지 못했거나 첫 방문이면 null. */
  audit: AuditSummary | null
  killSwitch: KillSwitchState | null
}

export interface VisitSeenResult {
  /** 새로 기록된 마지막 방문 시각(ISO 8601). */
  lastVisitAt: string
}

export interface VisitNotifySettings {
  /** 창이 비활성일 때 새 결재 요청을 OS 알림으로 알릴지. 기본 true. */
  enabled: boolean
}

export const VISIT_LIST_LIMIT = 50
