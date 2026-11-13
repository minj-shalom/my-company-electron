import { TICKET_ID } from '../repository/ids'
import type { SafeFs } from '../repository/safe-fs'
import type { ReviewChecker } from './gate-types'

const REPORTS_DIR = 'company/reports'

/**
 * 티켓 보고서(`company/reports/<티켓>-*.md`)의 마지막 `reviewer-qa` 줄에 "통과"가 있으면 검수 통과로 본다.
 * 임시안: 보고서는 에이전트가 쓰므로 위조 가능성이 있다. 구조화된 검수 기록이 생기면 교체한다 (COO 판단 사항).
 */
export function createReportReviewChecker(fs: SafeFs): ReviewChecker {
  return {
    async passed(_projectId, ticketId) {
      if (!TICKET_ID.test(ticketId)) return false
      const { files } = await fs.listMarkdown(REPORTS_DIR)
      for (const f of files) {
        if (!f.startsWith(`${ticketId}-`) && f !== `${ticketId}.md`) continue
        let text: string
        try {
          text = await fs.readText(`${REPORTS_DIR}/${f}`)
        } catch {
          continue
        }
        const last = text
          .split('\n')
          .filter((l) => l.includes('reviewer-qa'))
          .pop()
        if (last !== undefined && last.includes('통과') && !last.includes('미통과')) return true
      }
      return false
    }
  }
}
