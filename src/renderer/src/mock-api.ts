import type { WindowApi } from '../../shared/api'
import {
  mockDetectProviders,
  mockGetWeeklyLimits,
  mockSaveWeeklyLimits,
  mockTestConnection,
  resetMockOnboarding
} from './mock-onboarding'
import { createMockCompanyApi, parseCompanyScenario } from './mock-company'
import { mockGetOrg, parseOrgScenario } from './mock-org'
import { mockCompany, mockOrg, mockTickets } from './mock-data'
import { createMockDecisionApi, parseDecisionScenario } from './mock-decisions'

/** 브라우저 개발 모드 전용 mock. 동적 import로만 쓰이고 프로덕션에서는 dead code로 제거된다. */
const mockDecisionApi = createMockDecisionApi(
  parseDecisionScenario(typeof location === 'undefined' ? '' : location.search),
  // 두 번 클릭 방지 같은 처리 중 상태를 브라우저에서 볼 수 있게 한다. 테스트(location 없음)에서는 지연하지 않는다.
  typeof location === 'undefined' ? 0 : 400
)

/** 테스트용: 변경된 mock 상태를 초기값으로 되돌린다. */
export function resetMockApi(): void {
  mockDecisionApi.reset()
  resetMockOnboarding()
}

export const mockApi: WindowApi = {
  ping: async () => 'pong (mock)',
  startRun: async () => ({ ok: false, code: 'cli-not-found', message: 'mock: runner unavailable' }),
  cancelRun: async () => false,
  ...createMockCompanyApi(
    parseCompanyScenario(typeof location === 'undefined' ? '' : location.search)
  ),
  getCompany: async () => ({ ok: true, value: structuredClone(mockCompany) }),
  listEmployees: async () => ({ ok: true, value: structuredClone(mockOrg) }),
  getOrg: (...args) =>
    mockGetOrg(parseOrgScenario(typeof location === 'undefined' ? '' : location.search))(...args),
  listTickets: async (status) => ({
    ok: true,
    value: structuredClone(mockTickets.filter((t) => !status || t.status === status))
  }),
  getTicket: async (id) => {
    const t = mockTickets.find((x) => x.id === id)
    return t
      ? { ok: true, value: structuredClone(t) }
      : { ok: false, code: 'not-found', message: '티켓을 찾을 수 없습니다.' }
  },
  ...mockDecisionApi.api,
  detectProviders: mockDetectProviders,
  testProviderConnection: mockTestConnection,
  getWeeklyLimits: mockGetWeeklyLimits,
  saveWeeklyLimits: mockSaveWeeklyLimits,
  onRunEvent: () => () => {}
}
