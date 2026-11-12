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
  /** 마크다운. main 값은 신뢰하지 않으며 renderer는 sanitize 후 렌더링한다 (options[].description, memo도 동일). */
  question: string
  options: DecisionOption[]
  /** 추천 선택지 key. 실제 카드의 "A (필요해지면 C)" 같은 자유 서술에서 main이 key를 추출한다. 실패하면 null. */
  recommended: string | null
  /** 결정 완료 시 선택한 key. 카드의 자유 서술에서 main이 추출한다. pending이면 null. */
  chosen: string | null
  /** 결정 메모. */
  memo: string
}

/**
 * main은 이 요청을 신뢰하지 말고 반드시 검증한다.
 * - id: 허용 형식(예: ^D-\d+$)만 받는다. 파일 경로를 id로 조합하지 말고, 카드 목록에서 id로 찾은 항목의 경로만 쓴다.
 * - choice: 해당 카드 options[].key에 있는 값만 허용한다.
 * - memo: 길이를 제한한다 (예: 2000자).
 */
export interface DecisionResolveRequest {
  id: string
  /** 선택지 key. 승인/거절은 카드가 정의한 선택지로 표현한다. */
  choice: string
  memo?: string
}
