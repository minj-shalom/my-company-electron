import type { WindowApi } from '../../shared/api'
import type { Ticket, TicketStatus, UnreadableTicket } from '../../shared/ticket'

/**
 * 브라우저 개발 모드 전용. `?mock-tickets=empty|many|error|conflict|noassignee`로 상태를 고른다 (없으면 기본 샘플).
 * - noassignee: 담당 없음, 조직에 없는 직원(mock 조직에 없는 id), unreadable 샘플
 * - conflict: 이동하면 conflict를 돌려준다
 */
export type TicketScenario = 'samples' | 'empty' | 'many' | 'error' | 'conflict' | 'noassignee'
const SCENARIOS: readonly TicketScenario[] = [
  'samples',
  'empty',
  'many',
  'error',
  'conflict',
  'noassignee'
]

export function parseTicketScenario(search: string): TicketScenario {
  const v = new URLSearchParams(search).get('mock-tickets')
  return SCENARIOS.find((s) => s === v) ?? 'samples'
}

const ticket = (
  n: number,
  status: TicketStatus,
  title: string,
  assignee: string | null,
  department: string | null,
  body = `## 목표\n${title}\n\n<b>마크다운과 HTML은 그대로 글자로 보여요.</b>`
): Ticket => ({
  id: `T-${String(n).padStart(3, '0')}`,
  title,
  status,
  assignee,
  department,
  body
})

const SAMPLES: Ticket[] = [
  ticket(1, 'done', '로그인 화면', 'developer', '개발팀'),
  ticket(2, 'in-progress', '티켓 보드', 'ui-dev', '개발팀'),
  ticket(3, 'backlog', '사용량 표시', null, '재무'),
  ticket(4, 'backlog', '랜딩 페이지 초안', 'web-frontend-dev', '개발팀')
]

const MANY: Ticket[] = (() => {
  const people = ['developer', 'ui-dev', 'pm', 'cto', 'reviewer-qa', 'devops', null]
  const depts = ['개발팀', 'R&D', '기획팀', '재무', null]
  const statuses: TicketStatus[] = ['backlog', 'in-progress', 'done']
  const list = Array.from({ length: 30 }, (_, i) =>
    ticket(
      i + 1,
      statuses[(i * 7) % 3],
      i % 5 === 0
        ? `아주 긴 제목의 티켓입니다 ${i + 1}: 사용자에게 보이는 문구를 한국어로 정리하고 접근성 레이블을 점검한다`
        : `샘플 티켓 ${i + 1}`,
      people[i % people.length],
      depts[i % depts.length]
    )
  )
  list[3] = { ...list[3], bodyTruncated: true, body: '본문이 아주 긴 티켓입니다.\n'.repeat(40) }
  return list
})()

const NOASSIGNEE: Ticket[] = [
  ticket(10, 'backlog', '새 회사 첫 티켓', null, null),
  ticket(11, 'backlog', 'PM이 필요한 티켓', 'pm-lead', '기획팀'),
  ticket(12, 'in-progress', '구현 담당이 없는 티켓', 'backend-dev', '개발팀'),
  ticket(13, 'in-progress', '기본 직원이 맡은 티켓', 'cto', 'R&D'),
  ticket(14, 'done', '끝난 티켓', null, '개발팀')
]

const UNREADABLE: UnreadableTicket[] = [
  { path: 'company/tickets/backlog/T-030-broken.md', reason: 'unreadable' },
  { path: 'company/tickets/backlog/T-031-dup.md', reason: 'duplicate' },
  { path: 'company/tickets/in-progress/T-031-dup.md', reason: 'duplicate' },
  { path: 'company/tickets/done/T-032-huge.md', reason: 'too-large' }
]

function seed(s: TicketScenario): { items: Ticket[]; unreadable: UnreadableTicket[] } {
  if (s === 'empty' || s === 'error') return { items: [], unreadable: [] }
  if (s === 'many') return { items: MANY, unreadable: UNREADABLE.slice(0, 2) }
  if (s === 'noassignee') return { items: NOASSIGNEE, unreadable: UNREADABLE }
  return { items: SAMPLES, unreadable: [] }
}

export interface MockTicketApi {
  api: Pick<WindowApi, 'listTickets' | 'getTicket' | 'moveTicket'>
  reset: () => void
}

/** 처리 중 상태를 브라우저에서 볼 수 있도록 delayMs만큼 응답을 늦춘다 (테스트에서는 0). */
export function createMockTicketApi(scenario: TicketScenario, delayMs = 0): MockTicketApi {
  let state = structuredClone(seed(scenario))
  const wait = (): Promise<void> =>
    delayMs > 0 ? new Promise((r) => setTimeout(r, delayMs)) : Promise.resolve()
  return {
    reset: () => {
      state = structuredClone(seed(scenario))
    },
    api: {
      listTickets: async (status) => {
        if (scenario === 'error')
          return { ok: false, code: 'internal', message: '티켓을 불러오지 못했습니다.' }
        return {
          ok: true,
          value: {
            items: structuredClone(state.items.filter((t) => !status || t.status === status)),
            unreadable: structuredClone(state.unreadable)
          }
        }
      },
      getTicket: async (id) => {
        const t = state.items.find((x) => x.id === id)
        return t
          ? { ok: true, value: structuredClone(t) }
          : { ok: false, code: 'not-found', message: '티켓을 찾을 수 없습니다.' }
      },
      moveTicket: async ({ id, to }) => {
        await wait()
        if (scenario === 'conflict')
          return { ok: false, code: 'conflict', message: '대상 폴더에 같은 파일이 있습니다.' }
        const t = state.items.find((x) => x.id === id)
        if (!t) return { ok: false, code: 'not-found', message: '티켓을 찾을 수 없습니다.' }
        t.status = to
        return { ok: true, value: structuredClone(t) }
      }
    }
  }
}
