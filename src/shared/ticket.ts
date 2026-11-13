/** 티켓 타입. 원본은 `company/tickets/{backlog,in-progress,done}/*.md`. */

import type { UnreadableReason } from './decision'

export type TicketStatus = 'backlog' | 'in-progress' | 'done'

/** 이동 요청 등 외부 입력의 허용 값. 순서는 보드 칸 순서다. */
export const TICKET_STATUSES: readonly TicketStatus[] = ['backlog', 'in-progress', 'done']

/** 본문이 이 길이(문자 수)를 넘으면 main이 잘라서 보내고 `bodyTruncated`를 true로 표시한다. */
export const MAX_TICKET_BODY_CHARS = 200_000

export interface Ticket {
  /** 예: T-004 */
  id: string
  title: string
  status: TicketStatus
  /**
   * 담당 직원 id. 미배정이면 null. 값이 현재 조직에 없는 직원일 수 있다 (새 회사에는 pm·developer가 없다).
   * 이는 오류가 아니며 "담당 직원 없음(채용 필요)" 여부는 renderer가 조직도와 대조해 표시한다.
   */
  assignee: string | null
  /** 부서 이름(`- **부서:** 값`). 줄이 없으면 null. 이전 main/mock 호환을 위해 optional이며 없으면 null로 취급한다. */
  department?: string | null
  /** 마크다운 본문. renderer는 sanitize 후 렌더링한다. 너무 길면 잘린다 (`bodyTruncated`). */
  body: string
  /** 본문을 `MAX_TICKET_BODY_CHARS`에서 잘랐으면 true. 없으면 false로 취급한다. */
  bodyTruncated?: boolean
}

/** 목록에서 빠진 티켓이 있다는 사실만 알린다. path는 회사 폴더 기준 상대 경로이고 오류 원문이나 절대 경로는 담지 않는다. */
export interface UnreadableTicket {
  path: string
  /** `duplicate`: 같은 id의 티켓이 둘 이상의 폴더에 있어 숨김 (이동 도중 종료된 흔적). */
  reason: UnreadableReason
}

/** `ticket:list` 응답. 읽지 못한 티켓이 있어도 나머지는 `items`로 돌려준다. */
export interface TicketList {
  items: Ticket[]
  unreadable: UnreadableTicket[]
}

/**
 * `ticket:move` 요청. main은 이 요청을 신뢰하지 말고 검증한다.
 * - id: `^T-\d{1,6}$`만 허용. 경로는 id로 조합하지 않고 폴더 목록에서 찾은 파일만 쓴다.
 * - to: TICKET_STATUSES 중 하나. 세 상태 사이의 모든 이동을 허용한다.
 * 결과: 이미 `to` 상태면 변경 없이 ok(멱등). 대상 폴더에 다른 파일이 있으면 `conflict`.
 */
export interface TicketMoveRequest {
  id: string
  to: TicketStatus
}
