/** 티켓 타입. 원본은 `company/tickets/{backlog,in-progress,done}/*.md`. */

export type TicketStatus = 'backlog' | 'in-progress' | 'done'

export interface Ticket {
  /** 예: T-004 */
  id: string
  title: string
  status: TicketStatus
  /** 담당 직원 id. 미배정이면 null. */
  assignee: string | null
  /** 마크다운 본문. renderer는 sanitize 후 렌더링한다. */
  body: string
}
