import type { CompanyProfile } from '../../shared/company-profile'
import type { WindowApi } from '../../shared/api'
import type { ThemePreference } from '../../shared/theme'
import type { CredentialAdapterStatus } from '../../shared/publisher'
import {
  mockDetectProviders,
  mockGetWeeklyLimits,
  mockSaveWeeklyLimits,
  mockTestConnection,
  resetMockOnboarding,
  seedMockLimits
} from './mock-onboarding'
import { createMockCompanyApi, parseCompanyScenario } from './mock-company'
import { mockGetOrg, parseOrgScenario, resetMockOrgState } from './mock-org'
import { MOCK_TEMPLATES, createMockHireApi, parseHireScenario } from './mock-hire'
import { createMockDepartmentApi, parseDepartmentScenario } from './mock-department'
import { createMockEmployeeApi, parseEmployeeScenario } from './mock-employee'
import { mockCompany, mockOrg } from './mock-data'
import { createMockTicketApi, parseTicketScenario } from './mock-tickets'
import { createMockRunApi, parseRunScenario } from './mock-run'
import { createMockProjectApi, parseProjectScenario } from './mock-projects'
import { createMockGateApi, parseGateScenario } from './mock-gate'
import { createMockRecurringApi, parseRecurringScenario } from './mock-recurring'
import { createMockPublicationApi } from './mock-publication'
import { createMockPolicyApi, parsePolicyScenario } from './mock-policy'
import { mockProjectTemplateApi } from './mock-project-templates'
import { createMockUsageApi, parseUsageScenario } from './mock-usage'
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

const mockPolicyApi = createMockPolicyApi(
  parsePolicyScenario(typeof location === 'undefined' ? '' : location.search),
  typeof location === 'undefined' ? 0 : 300,
  async () => {
    const r = await mockProjectApi.api.listProjects()
    return r.ok ? r.value.items.map((p) => ({ id: p.id, name: p.name })) : []
  }
)

const mockRecurringApi = createMockRecurringApi(
  parseRecurringScenario(typeof location === 'undefined' ? '' : location.search)
)

const mockPublicationApi = createMockPublicationApi()

const mockEmployeeApi = createMockEmployeeApi(
  parseEmployeeScenario(typeof location === 'undefined' ? '' : location.search),
  typeof location === 'undefined' ? 0 : 400,
  mockHireApi.api.createEmployee,
  MOCK_TEMPLATES
)

const mockUsageApi = createMockUsageApi(
  parseUsageScenario(typeof location === 'undefined' ? '' : location.search),
  typeof location === 'undefined' ? 0 : 300,
  {
    get: async () => {
      const r = await mockGetWeeklyLimits()
      return r.ok ? r : { ok: false }
    },
    seed: seedMockLimits
  }
)

/** 테스트용: 변경된 mock 상태를 초기값으로 되돌린다. */
/** 값 없는 상태만 있다. 개발 모드 전용이며 프로덕션 번들에 넣지 않는다. */
const mockCredential: CredentialAdapterStatus = {
  adapterId: 'demo',
  displayName: '데모 블로그',
  scopes: [{ id: 'post:write', description: '글 게시만 허용 (읽기·삭제 없음)' }],
  state: 'disconnected',
  accounts: [],
  encryptionAvailable: true
}
let mockTheme: ThemePreference = 'system'
const MOCK_PROFILE: CompanyProfile = {
  name: 'My Company',
  vision: 'AI 직원이 함께 일하는 회사를 만든다.',
  mission: '사람이 방향을 정하고 AI 직원이 실행한다.',
  principles: '- 마크다운이 원본이다.',
  revision: 'r1'
}
let mockProfile: CompanyProfile = { ...MOCK_PROFILE }

export function resetMockApi(): void {
  mockTheme = 'system'
  mockProfile = { ...MOCK_PROFILE }
  mockTicketApi.reset()
  mockDecisionApi.reset()
  mockProjectApi.reset()
  mockPolicyApi.reset()
  mockRecurringApi.reset()
  mockPublicationApi.reset()
  mockGateApi.reset()
  resetMockOnboarding()
  mockUsageApi.reset()
  resetMockOrgState()
}

const mockGateApi = createMockGateApi(
  parseGateScenario(typeof location === 'undefined' ? '' : location.search)
)

export const mockApi: WindowApi = {
  ping: async () => 'pong (mock)',
  ...mockGateApi.api,
  getSchedulerStatus: async () => ({
    ok: true,
    value: {
      enabled: false,
      intervalMinutes: 180,
      activeHours: '09:00-22:00',
      state: 'idle',
      lastRunAt: null,
      nextRunAt: null,
      lastResult: null,
      warnings: []
    }
  }),
  runSchedulerNow: async () => ({ ok: true, value: { started: true } }),
  // 인사 변경 가드레일(T-052)의 UI는 T-046이 만든다. 그 전까지 격리된 직원은 없고 복원·승인은 no-op이다.
  getQuarantinedEmployees: async () => ({ ok: true, value: [] }),
  restoreIntegrity: async () => ({ ok: true, value: { ok: true, restored: 0 } }),
  acceptIntegrity: async () => ({ ok: true, value: { ok: true, restored: 0 } }),
  ...mockRunApi,
  ...createMockCompanyApi(
    parseCompanyScenario(typeof location === 'undefined' ? '' : location.search)
  ),
  getCompany: async () => ({ ok: true, value: structuredClone(mockCompany) }),
  listEmployees: async () => ({ ok: true, value: structuredClone(mockOrg) }),
  getOrg: async (...args) => {
    const r = await mockGetOrg(
      parseOrgScenario(typeof location === 'undefined' ? '' : location.search)
    )(...args)
    if (!r.ok) return r
    // 담당 프로젝트는 프로젝트 mock이 원본이다 (배정/해제가 조직 조회에 바로 반영된다).
    const agents = r.value.agents.map((a) => ({
      ...a,
      projects: mockProjectApi.entriesFor(a.id).map((e) => ({
        id: e.projectId,
        name: e.projectName,
        role: e.role,
        active: e.active
      }))
    }))
    return { ok: true, value: { ...r.value, agents } }
  },
  ...mockTicketApi.api,
  // 티켓 생성·편집 화면은 T-044 2단계(ui-dev)에서 시나리오 mock으로 바꾼다.
  ...mockDecisionApi.api,
  ...mockHireApi.api,
  ...mockEmployeeApi.api,
  ...createMockDepartmentApi(
    parseDepartmentScenario(typeof location === 'undefined' ? '' : location.search),
    typeof location === 'undefined' ? 0 : 400,
    async () => {
      const r = await mockApi.getOrg()
      return r.ok ? r.value : null
    }
  ),
  ...mockProjectApi.api,
  ...mockPolicyApi.api,
  ...mockRecurringApi.api,
  ...mockPublicationApi.api,
  ...mockProjectTemplateApi,
  detectProviders: mockDetectProviders,
  testProviderConnection: mockTestConnection,
  ...mockUsageApi.api,
  getWeeklyLimits: mockGetWeeklyLimits,
  saveWeeklyLimits: mockSaveWeeklyLimits,
  getCompanyProfile: async () => ({ ok: true, value: mockProfile }),
  saveCompanyProfile: async (req) => {
    if (req.revision !== mockProfile.revision)
      return {
        ok: false,
        code: 'conflict',
        message: '다른 곳에서 회사 정보가 바뀌었습니다. 새로 불러오세요.'
      }
    mockProfile = { ...req, revision: `r${Number(mockProfile.revision.slice(1)) + 1}` }
    return { ok: true, value: mockProfile }
  },
  getCredentialStatus: async () => ({ ok: true, value: [mockCredential] }),
  disconnectCredential: async (req) =>
    req.adapterId === mockCredential.adapterId
      ? { ok: true, value: { status: mockCredential, revoked: false } }
      : { ok: false, code: 'invalid-request', message: '알 수 없는 연결입니다.' },
  getTheme: async () => ({ ok: true, value: mockTheme }),
  saveTheme: async (theme) => {
    mockTheme = theme
    return { ok: true, value: theme }
  }
}
