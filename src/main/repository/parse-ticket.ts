import type { Ticket, TicketStatus } from '../../shared/ticket'
import { asString, firstHeading, metaValue, splitFrontmatter } from './markdown'
import { EMPLOYEE_ID, TICKET_ID, leadingId } from './ids'

/** 티켓 상태 폴더. 폴더가 상태의 원본이다 (본문의 상태 줄이 달라도 폴더를 따른다). */
export const TICKET_DIRS: Record<TicketStatus, string> = {
  backlog: 'company/tickets/backlog',
  'in-progress': 'company/tickets/in-progress',
  done: 'company/tickets/done'
}

/** 실패하면 사유가 담긴 Error를 던진다. 호출자가 오류 항목으로 변환한다. */
export function parseTicket(fileName: string, text: string, status: TicketStatus): Ticket {
  const id = leadingId(fileName, 'T')
  if (!id || !TICKET_ID.test(id)) throw new Error('파일명이 T-번호로 시작해야 합니다.')
  const { data, body } = splitFrontmatter(text)
  const heading = firstHeading(body)
  const title = asString(data.title) ?? heading?.replace(/^T-\d+\s*[:：]\s*/, '') ?? null
  if (!title) throw new Error('제목(# T-번호: 제목)을 찾을 수 없습니다.')
  const rawAssignee = asString(data.assignee) ?? metaValue(body, '담당')
  return { id, title, status, assignee: pickEmployeeId(rawAssignee), body }
}

function pickEmployeeId(raw: string | null): string | null {
  if (!raw) return null
  const token = /[`]?([a-z0-9][a-z0-9-]*)[`]?/.exec(raw.trim())
  return token && EMPLOYEE_ID.test(token[1]) ? token[1] : null
}

const STATUS_LINE = /^([ \t]*[-*][ \t]+\*\*상태:\*\*)[ \t]*.*$/

/**
 * 본문의 `- **상태:** ...` 줄을 새 상태로 바꾼다. 줄이 없으면 그대로 둔다.
 * `m` 플래그 정규식 대신 `\n` 단위로 훑는다: `\s*`가 개행을 넘어 큰 파일에서 느려질 수 있고,
 * 단독 `\r`/LS 같은 문자로 줄이 위조되는 것도 막기 위해서다. 각 줄 끝의 `\r`(CRLF)은 보존한다.
 */
export function withTicketStatus(text: string, status: TicketStatus): string {
  const lines = text.split('\n')
  for (const [i, line] of lines.entries()) {
    const cr = line.endsWith('\r') ? '\r' : ''
    const m = STATUS_LINE.exec(cr ? line.slice(0, -1) : line)
    if (m) {
      lines[i] = `${m[1]} ${status}${cr}`
      break
    }
  }
  return lines.join('\n')
}
