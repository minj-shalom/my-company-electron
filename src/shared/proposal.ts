/** 결재함 승인 카드(T-046) 계약. 카드 본문의 `proposal` 블록은 에이전트가 쓴 신뢰할 수 없는 텍스트다. */

export const PROPOSAL_ACTIONS = [
  'assign',
  'unassign',
  'hire',
  'update',
  'move',
  'retire',
  'policy-change'
] as const
export type ProposalActionKind = (typeof PROPOSAL_ACTIONS)[number]

export const MAX_PROPOSAL_ACTIONS = 10

/** 파싱된 액션. 알 수 없는 키는 파서가 거부하므로 이 모양만 존재한다. */
export type ProposalAction =
  | { action: 'assign' | 'unassign'; project: string; employee: string }
  | {
      action: 'hire'
      template: string
      id: string
      department: string
      reportsTo: string
      title?: string
      role?: string
    }
  | {
      action: 'update'
      id: string
      description?: string
      model?: string
      tools?: string[]
      /** 변경 전 직원 파일의 sha256. 승인 시점의 현재 해시와 다르면 stale. */
      base?: string
      /** 변경 후 직원 파일의 sha256. 있으면 적용 결과가 이 값과 같아야 한다 (hr 재편집 경로의 승인 해시). */
      after?: string
    }
  | {
      action: 'move'
      id: string
      department?: string
      reportsTo?: string
      title?: string
      role?: string
    }
  | { action: 'retire'; id: string }
  | { action: 'policy-change'; project: string; revision: string; values: unknown }

/** `proposal:apply` 요청. 결재함의 승인/거절 클릭 이벤트 한 곳에서만 보낸다. */
export interface ProposalApplyRequest {
  /** 결정 카드 번호 (예: D-021). */
  id: string
  /** 카드 선택지 key. 승인은 적용, 그 외 선택지는 해당 카드 유형의 처리를 한다. */
  choice: string
  /** 되돌리기 계열 카드에 실린 상태 해시. 있으면 현재 상태와 같을 때만 동작한다. */
  stateHash?: string
}

export type ProposalApplyStatus =
  | 'applied' // 제안 적용 완료 (카드는 done)
  | 'approved-pending-edit' // 승인 해시 저장 완료. hr 재편집을 기다린다
  | 'rejected' // 거절 처리
  | 'already-applied'
  | 'already-rejected'
  | 'restored' // integrity-warning/revert-suggestion 되돌리기
  | 'accepted' // revert-suggestion 사후 승인
  | 'dismissed' // 그대로 두기, 확인

/** 적용 실패 사유. UI는 코드별 고정 한국어 문장을 보여 준다. */
export const PROPOSAL_FAILURE_CODES = [
  'not-actionable', // 알 수 없는 액션·형식 오류·허용되지 않는 카드
  'stale', // 기준값이 바뀜: 다시 제안해야 한다
  'protected', // CEO/COO 행 또는 불변 정책 완화
  'rejected-by-rule', // 서비스 규칙이 거부 (중복, 순환 등)
  'hash-mismatch', // 적용 결과가 승인 해시와 다름
  'busy',
  'failed'
] as const
export type ProposalFailureCode = (typeof PROPOSAL_FAILURE_CODES)[number]

/** 처리 결과. `ok: false`는 카드를 pending에 그대로 둔 실패이고 코드는 UI가 고정 문장으로 바꾼다. */
export type ProposalApplyResult =
  | {
      ok: true
      status: ProposalApplyStatus
      /** 적용된 액션 수 (`applied`일 때). */ applied?: number
    }
  | { ok: false; code: ProposalFailureCode }
