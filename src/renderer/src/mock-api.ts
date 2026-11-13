import type { WindowApi } from '../../shared/api'
import type { ApiResult } from '../../shared/result'
import {
  mockDetectProviders,
  mockGetWeeklyLimits,
  mockSaveWeeklyLimits,
  mockTestConnection,
  resetMockOnboarding
} from './mock-onboarding'
import { createMockCompanyApi, parseCompanyScenario } from './mock-company'
import { mockGetOrg, parseOrgScenario, resetMockOrgState } from './mock-org'
import { createMockHireApi, parseHireScenario } from './mock-hire'
import { mockCompany, mockOrg } from './mock-data'
import { createMockTicketApi, parseTicketScenario } from './mock-tickets'
import { createMockRunApi, parseRunScenario } from './mock-run'
import { createMockProjectApi, parseProjectScenario } from './mock-projects'
import { createMockDecisionApi, parseDecisionScenario } from './mock-decisions'

/** 브라우저 개발 모드 전용 mock. 동적 import로만 쓰이고 프로덕션에서는 dead code로 제거된다. */
const mockDecisionApi = createMockDecisionApi(
  parseDecisionScenario(typeof location === 'undefined' ? '' : location.search),
  // 두 번 클릭 방지 같은 처리 중 상태를 브라우저에서 볼 수 있게 한다. 테스트(location 없음)에서는 지연하지 않는다.
  typeof location === 'undefined' ? 0 : 400
)

const mockTicketApi = createMockTicketApi(
  parseTicketScenario(typeof location === 'undefined' ? '' : location.search),
  typeof location === 'undefined' ? 0 : 400
)

const mockRunApi = createMockRunApi(
  parseRunScenario(typeof location === 'undefined' ? '' : location.search),
  typeof location === 'undefined' ? 0 : 700
)

const mockHireApi = createMockHireApi(
  parseHireScenario(typeof location === 'undefined' ? '' : location.search),
  typeof location === 'undefined' ? 0 : 500
)

const mockProjectApi = createMockProjectApi(
  parseProjectScenario(typeof location === 'undefined' ? '' : location.search),
  typeof location === 'undefined' ? 0 : 400,
  typeof location === 'undefined' ? '' : location.search
)

/** 테스트용: 변경된 mock 상태를 초기값으로 되돌린다. */
export function resetMockApi(): void {
  mockTicketApi.reset()
  mockDecisionApi.reset()
  mockProjectApi.reset()
  resetMockOnboarding()
  resetMockOrgState()
}

const mockNotImplemented = async (): Promise<ApiResult<never>> => ({
  ok: false,
  code: 'not-implemented',
  message: '아직 지원하지 않는 기능입니다.'
})

export const mockApi: WindowApi = {
  ping: async () => 'pong (mock)',
  ...mockRunApi,
  ...createMockCompanyApi(
    parseCompanyScenario(typeof location === 'undefined' ? '' : location.search)
  ),
  getCompany: async () => ({ ok: true, value: structuredClone(mockCompany) }),
  listEmployees: async () => ({ ok: true, value: structuredClone(mockOrg) }),
  getOrg: (...args) =>
    mockGetOrg(parseOrgScenario(typeof location === 'undefined' ? '' : location.search))(...args),
  ...mockTicketApi.api,
  // 티켓 생성·편집 화면은 T-044 2단계(ui-dev)에서 시나리오 mock으로 바꾼다.
  ...mockDecisionApi.api,
  // 직원 변경 화면은 T-039. 그 전까지 채용 계열(템플릿 목록, hr 추가, 첫 채용)만 시나리오 mock이고 나머지 쓰기는 not-implemented다.
  ...mockHireApi.api,
  updateEmployee: mockNotImplemented,
  moveEmployee: mockNotImplemented,
  retireEmployee: mockNotImplemented,
  ...mockProjectApi.api,
  detectProviders: mockDetectProviders,
  testProviderConnection: mockTestConnection,
  getWeeklyLimits: mockGetWeeklyLimits,
  saveWeeklyLimits: mockSaveWeeklyLimits
}
