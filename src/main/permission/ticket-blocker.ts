import { TICKET_ID } from '../repository/ids'
import { TICKET_DIRS } from '../repository/parse-ticket'
import { FsGuardError, MAX_FILE_BYTES, relPath, type SafeFs } from '../repository/safe-fs'

const STATUSES = ['in-progress', 'backlog', 'done'] as const

/**
 * 티켓 끝에 막힌 점을 덧붙인다. 파일은 번호로 찾은 것만 쓰고 기존 내용은 그대로 둔다.
 * 티켓을 찾지 못하거나 너무 커지면 false (호출 측이 브리핑에 남긴다).
 */
export async function appendTicketBlocker(
  fs: SafeFs,
  ticketId: string,
  text: string,
  date: string
): Promise<boolean> {
  if (!TICKET_ID.test(ticketId)) return false
  for (const st of STATUSES) {
    const { files } = await fs.listMarkdown(TICKET_DIRS[st])
    const name = files.find((f) => f.startsWith(`${ticketId}-`) || f === `${ticketId}.md`)
    if (name === undefined) continue
    const path = relPath(TICKET_DIRS[st], name)
    try {
      const body = await fs.readText(path)
      const line = text.replace(/[\r\n\u2028\u2029]+/g, ' ').slice(0, 300)
      const next = `${body.replace(/\s*$/, '')}\n\n## 막힌 점\n- ${date}: ${line}\n`
      if (Buffer.byteLength(next, 'utf8') > MAX_FILE_BYTES) return false
      await fs.writeText(path, next, true)
      return true
    } catch (e) {
      if (e instanceof FsGuardError) return false
      throw e
    }
  }
  return false
}
