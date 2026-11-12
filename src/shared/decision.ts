/** 결정 카드 타입. 원본은 `company/decisions/{pending,done}/*.md`. */

export type DecisionStatus = 'pending' | 'done'

export interface DecisionOption {
  /** 선택지 식별자 (예: A). */
  key: string
  label: string
  description: string
}

export interface Decision {
  /** 예: D-006 */
  id: string
  title: string
  status: DecisionStatus
  /** 관련 티켓 id. 없으면 null. */
  ticketId: string | null
  question: string
  options: DecisionOption[]
  /** 추천 선택지 key. 없으면 null. */
  recommended: string | null
  /** 결정 완료 시 선택한 key. pending이면 null. */
  chosen: string | null
  /** 결정 메모. */
  memo: string
}

export interface DecisionResolveRequest {
  id: string
  /** 선택지 key. 승인/거절은 카드가 정의한 선택지로 표현한다. */
  choice: string
  memo?: string
}
