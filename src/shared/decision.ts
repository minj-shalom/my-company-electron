/** 결정 카드 타입. 원본은 `company/decisions/{pending,done}/*.md`. */

export type DecisionStatus = 'pending' | 'done'

/** 결재 유형. 카드의 `- **유형:** <값>` 줄을 이 허용 목록으로만 해석한다. */
export const DECISION_KINDS = [
  'decision',
  'permission',
  'proposal',
  'content-approval',
  'integrity-warning',
  'revert-suggestion',
  'git-confirm'
] as const
export type DecisionKind = (typeof DECISION_KINDS)[number]

/** `proposal` 카드의 제안자. */
export const DECISION_PROPOSERS = ['hr', 'coo'] as const
export type DecisionProposer = (typeof DECISION_PROPOSERS)[number]

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
  /** 결재 유형. 줄이 없거나 허용 목록 밖이면 main이 `decision`으로 채운다. 이전 main/mock 호환을 위해 optional이며 없으면 `decision`으로 취급한다. */
  kind?: DecisionKind
  /** 제안자 줄(`- **제안자:** hr|coo`)이 허용 값일 때만 채운다. 없거나 알 수 없으면 null/undefined. */
  proposedBy?: DecisionProposer | null
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

/** 목록에서 빠진 카드가 있다는 사실만 알린다. path는 회사 폴더 기준 상대 경로이고 오류 원문이나 절대 경로는 담지 않는다. */
export const UNREADABLE_REASONS = ['unreadable', 'duplicate', 'too-large'] as const
export type UnreadableReason = (typeof UNREADABLE_REASONS)[number]

export interface UnreadableDecision {
  path: string
  /** `duplicate`: 같은 id의 카드가 pending/done 또는 같은 폴더에 둘 이상 있어 숨김. */
  reason: UnreadableReason
}

/** `decision:list` 응답. 읽지 못한 카드가 있어도 나머지는 `items`로 돌려준다. */
export interface DecisionList {
  items: Decision[]
  unreadable: UnreadableDecision[]
}
