import type { Ticket, TicketStatus } from '../../shared/ticket'
import { FORGED_LINE_BREAK, asString, firstHeading, metaValue, splitFrontmatter } from './markdown'
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
  const department = pickDepartment(asString(data.department) ?? metaValue(body, '부서'))
  return { id, title, status, assignee: pickEmployeeId(rawAssignee), department, body }
}

const MAX_DEPARTMENT_LENGTH = 50

/** 표시용 이름이라 길이만 제한하고 비어 있으면 null. 조직도에 없는 부서여도 오류가 아니다. */
function pickDepartment(raw: string | null): string | null {
  const v = raw?.trim().slice(0, MAX_DEPARTMENT_LENGTH).trim()
  return v ? v : null
}

function pickEmployeeId(raw: string | null): string | null {
  if (!raw) return null
  const token = /[`]?([a-z0-9][a-z0-9-]*)[`]?/.exec(raw.trim())
  return token && EMPLOYEE_ID.test(token[1]) ? token[1] : null
}

const STATUS_PREFIX = /^[-*][ \t]+\*\*상태:\*\*/
const FENCE_LINE = /^[ \t]*(```|~~~)/

/**
 * 메타 영역의 `- **상태:** ...` 줄을 새 상태로 바꾼다. 줄이 없으면 그대로 둔다.
 * - 대상은 frontmatter 뒤, 첫 `# ` 제목 이후부터 첫 `## ` 앞까지의 영역에서 코드 펜스 밖이고 들여쓰지 않은 최상위 목록 줄이다
 *   (코드 예시나 중첩 목록의 같은 모양 줄을 건드리지 않는다).
 * - 줄 뒤에 붙어 있던 내용(예: `- **상태:** backlog (보류)`의 메모)은 지워진다. 상태 줄은 값 하나만 갖는다는 규칙이다.
 * - `\n` 단위로 훑고 값 부분에는 정규식을 쓰지 않는다 (`[ \t]*.*$`는 공백이 긴 줄에서 O(n²)가 되고,
 *   단독 `\r`/LS로 줄이 위조되는 것도 막아야 한다). 각 줄 끝의 `\r`(CRLF)은 보존한다.
 */
export function withTicketStatus(text: string, status: TicketStatus): string {
  const lines = text.split('\n')
  let from = 0
  if (/^\uFEFF?---[ \t]*\r?$/.test(lines[0] ?? '')) {
    const end = lines.findIndex((l, i) => i > 0 && /^---[ \t]*\r?$/.test(l))
    from = end < 0 ? 0 : end + 1
  }
  let fence = false
  let afterHeading = from
  for (let i = from; i < lines.length; i++) {
    if (FENCE_LINE.test(lines[i])) fence = !fence
    if (!fence && /^#[ \t]/.test(lines[i])) {
      afterHeading = i + 1
      break
    }
  }
  fence = false
  for (let i = afterHeading; i < lines.length; i++) {
    const line = lines[i]
    if (FENCE_LINE.test(line)) fence = !fence
    if (fence) continue
    if (/^##[ \t]/.test(line)) break
    const cr = line.endsWith('\r') ? '\r' : ''
    const bare = cr ? line.slice(0, -1) : line
    const m = STATUS_PREFIX.exec(bare)
    if (m && !FORGED_LINE_BREAK.test(bare.slice(m[0].length))) {
      lines[i] = `${m[0]} ${status}${cr}`
      break
    }
  }
  return lines.join('\n')
}
