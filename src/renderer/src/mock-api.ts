import type { WindowApi } from '../../shared/api'
import {
  mockDetectProviders,
  mockGetWeeklyLimits,
  mockSaveWeeklyLimits,
  mockTestConnection,
  resetMockOnboarding
} from './mock-onboarding'
import { createMockCompanyApi, parseCompanyScenario } from './mock-company'
import { mockGetOrg, parseOrgScenario, resetMockOrgState } from './mock-org'
import { MOCK_TEMPLATES, createMockHireApi, parseHireScenario } from './mock-hire'
import { createMockEmployeeApi, parseEmployeeScenario } from './mock-employee'
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

const mockEmployeeApi = createMockEmployeeApi(
  parseEmployeeScenario(typeof location === 'undefined' ? '' : location.search),
  typeof location === 'undefined' ? 0 : 400,
  mockHireApi.api.createEmployee,
  MOCK_TEMPLATES
)

/** 테스트용: 변경된 mock 상태를 초기값으로 되돌린다. */
export function resetMockApi(): void {
  mockTicketApi.reset()
  mockDecisionApi.reset()
  mockProjectApi.reset()
  resetMockOnboarding()
  resetMockOrgState()
}

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
  ...mockHireApi.api,
  ...mockEmployeeApi.api,
  ...mockProjectApi.api,
  // 배정 화면은 T-045 2단계(ui-dev)에서 시나리오 mock으로 바꾼다. 그 전까지는 빈 결과/실패로 계약만 맞춘다.
  assignProjectEmployee: async () => ({
    ok: false,
    code: 'internal',
    message: '브라우저 개발 모드에서는 지원하지 않습니다.'
  }),
  unassignProjectEmployee: async () => ({
    ok: false,
    code: 'internal',
    message: '브라우저 개발 모드에서는 지원하지 않습니다.'
  }),
  listEmployeeProjects: async (req) => ({
    ok: true,
    value: { employeeId: req.id, projects: [], issues: [] }
  }),
  detectProviders: mockDetectProviders,
  testProviderConnection: mockTestConnection,
  getWeeklyLimits: mockGetWeeklyLimits,
  saveWeeklyLimits: mockSaveWeeklyLimits
}
