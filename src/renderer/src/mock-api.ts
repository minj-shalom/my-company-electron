import type { WindowApi } from '../../shared/api'
import type { Decision } from '../../shared/decision'
import { mockCompany, mockDecisions, mockOrg, mockTickets } from './mock-data'

/** 브라우저 개발 모드 전용 mock. 동적 import로만 쓰이고 프로덕션에서는 dead code로 제거된다. */
const decisions: Decision[] = structuredClone(mockDecisions)

export const mockApi: WindowApi = {
  ping: async () => 'pong (mock)',
  startRun: async () => ({ ok: false, code: 'cli-not-found', message: 'mock: runner unavailable' }),
  cancelRun: async () => false,
  createCompany: async (req) => ({ ok: true, companyDir: `/mock/${req.name}` }),
  selectCompanyFolder: async () => '/mock',
  getCompany: async () => ({ ok: true, value: mockCompany }),
  listEmployees: async () => ({ ok: true, value: structuredClone(mockOrg) }),
  listTickets: async (status) => ({
    ok: true,
    value: mockTickets.filter((t) => !status || t.status === status)
  }),
  getTicket: async (id) => {
    const t = mockTickets.find((x) => x.id === id)
    return t
      ? { ok: true, value: t }
      : { ok: false, code: 'not-found', message: '티켓을 찾을 수 없습니다.' }
  },
  listDecisions: async (status) => ({
    ok: true,
    value: decisions.filter((d) => !status || d.status === status)
  }),
  resolveDecision: async (req) => {
    const d = decisions.find((x) => x.id === req.id)
    if (!d) return { ok: false, code: 'not-found', message: '결정 카드를 찾을 수 없습니다.' }
    if (d.status === 'done')
      return { ok: false, code: 'conflict', message: '이미 처리된 결정입니다.' }
    if (!d.options.some((o) => o.key === req.choice))
      return { ok: false, code: 'invalid-request', message: '알 수 없는 선택지입니다.' }
    d.status = 'done'
    d.chosen = req.choice
    d.memo = req.memo ?? ''
    return { ok: true, value: d }
  },
  onRunEvent: () => () => {}
}
