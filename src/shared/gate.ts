/** 자동 모드 실행 게이트(T-053) 계약. 게이트 도구, 킬 스위치, 감사 요약이 main/preload/renderer에서 공유한다. */
import type { LimitedAction } from './policy'

export const GATE_TOOL_NAMES = ['gate_push', 'gate_merge', 'gate_publish'] as const
export type GateToolName = (typeof GATE_TOOL_NAMES)[number]

/** CLI에 노출하는 도구 서버 이름. 허용 목록 항목은 `mcp__<서버>__<도구>` 형식이다. */
export const GATE_SERVER_NAME = 'gate'

export const GATE_ACTION_OF_TOOL: Record<GateToolName, LimitedAction> = {
  gate_push: 'push',
  gate_merge: 'merge',
  gate_publish: 'publish'
}

/** 게이트 호출 결과. `card`는 사람 컨펌 카드를 남기고 실행하지 않았다는 뜻이다. */
export const GATE_STATUSES = ['executed', 'card', 'blocked', 'failed', 'duplicate'] as const
export type GateStatus = (typeof GATE_STATUSES)[number]

export interface GateResult {
  status: GateStatus
  /** LLM과 로그에 그대로 나가는 짧은 한국어 문장. 경로, 환경변수, 자격 증명을 담지 않는다. */
  message: string
  cardId?: string
}

/** 감사 기록 한 줄의 결과 값. 닫힌 목록이라 원문 오류 문구가 들어갈 수 없다. */
export const AUDIT_RESULTS = [
  'executed',
  'failed',
  'blocked-limit',
  'blocked-killswitch',
  'blocked-target',
  'blocked-review',
  'fallback-card',
  'duplicate'
] as const
export type AuditResult = (typeof AUDIT_RESULTS)[number]

export interface KillSwitchState {
  /** 회사 전체 중지. */
  company: boolean
  /** 프로젝트별 중지. */
  projects: string[]
  /** ISO 8601. 한 번도 바꾸지 않았으면 null. */
  updatedAt: string | null
}

export interface KillSwitchSetRequest {
  scope: 'company' | 'project'
  /** scope가 project일 때만. */
  projectId?: string
  /** true면 중지, false면 해제. */
  engaged: boolean
}

export interface AuditSummaryRequest {
  /** ISO 8601 날짜 또는 일시. 이 시각 이후(포함). */
  from: string
  /** 이 시각 이전(미포함). */
  to: string
}

export interface AuditFailure {
  at: string
  action: LimitedAction
  /** 브랜치 또는 초안 경로와 짧은 해시. */
  target: string
  result: AuditResult
  employee: string
  ticket: string
}

export interface AuditProjectSummary {
  projectId: string
  /** 동작별 결과 건수. */
  counts: Record<LimitedAction, Record<AuditResult, number>>
  /** 실패·차단 목록(최신이 먼저, 최대 50건). */
  failures: AuditFailure[]
}

export interface AuditSummary {
  from: string
  to: string
  projects: AuditProjectSummary[]
}
