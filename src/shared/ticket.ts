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
  /**
   * 소속 프로젝트 id (`- **프로젝트:** id`). 줄이 없거나 id 형식이 아니면 null = "회사 공통".
   * 등록되지 않았거나 보관된 프로젝트일 수 있으며 오류가 아니다 (`summarizeProjects`가 "미확인"으로 분류).
   * 이전 main/mock 호환을 위해 optional이며 없으면 null로 취급한다.
   */
  projectId?: string | null
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

export const MAX_TICKET_TITLE = 100
export const MAX_TICKET_GOAL = 2000
export const MAX_TICKET_CRITERIA = 20
export const MAX_TICKET_CRITERION = 300
export const MAX_TICKET_DEPARTMENT = 50

/**
 * `ticket:create` 요청. main이 검증하고 번호는 main이 부여한다 (요청에 id가 있으면 거부).
 * - title 1~100자(한 줄), goal 최대 2000자(여러 줄 허용, `#`·코드 펜스로 시작하는 줄은 거부), criteria 1~20개·항목당 300자(한 줄)
 * - 제어 문자·줄 구분자·방향 제어 문자는 제거한 뒤 길이를 잰다
 * - assignee: 현재 조직의 직원 id, null은 "담당 없음"(정상). 생략하면 프로젝트의 담당 PM(`ready`일 때)이 기본값이고 없으면 담당 없음
 * - projectId: 보관되지 않은 프로젝트의 id, null/생략은 "회사 공통"
 * 결과: 만들어진 티켓(`backlog`). 번호 충돌은 main이 1회 재시도한 뒤에도 실패하면 `conflict`.
 */
export interface TicketCreateRequest {
  title: string
  goal: string
  criteria: string[]
  assignee?: string | null
  department?: string | null
  projectId?: string | null
}

/**
 * `ticket:update` 요청. backlog 티켓만 편집한다 (그 외는 `forbidden`).
 * - expectedBody: 편집을 시작할 때 받은 `Ticket.body`. 지금 파일과 다르면 `conflict` (외부 수정 보호). 잘린 본문(`bodyTruncated`)은 편집 불가.
 * - 담당·부서·프로젝트는 생략하지 않고 현재 값을 그대로 보낸다 (null = 없음/회사 공통). 보관된 프로젝트는 기존 값 유지만 허용.
 * - 제목, 담당, 부서, 프로젝트, `## 목표`, `## 완료 조건`만 바꾸고 나머지 본문(의존, 메모 등)은 보존한다.
 */
export interface TicketUpdateRequest {
  id: string
  expectedBody: string
  title: string
  goal: string
  criteria: string[]
  assignee: string | null
  department: string | null
  projectId: string | null
}

/**
 * 프로젝트를 고를 때 담당 칸에 채울 기본값 (CEO 확정: 그 프로젝트의 담당 PM). `ready`가 아니면 null.
 * 화면과 main(정기 티켓 T-049 포함)이 같은 규칙을 쓰도록 shared에 둔다.
 */
export function defaultTicketAssignee(
  project: { state: 'ready' | 'pm-required' | 'archived'; pmId: string | null } | null
): string | null {
  return project !== null && project.state === 'ready' ? project.pmId : null
}
