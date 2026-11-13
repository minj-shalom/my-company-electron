import type { WindowApi } from '../../shared/api'
import { USAGE_SETTINGS_DEFAULT } from '../../shared/usage'
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
import { createMockGateApi, parseGateScenario } from './mock-gate'
import { createMockPolicyApi, parsePolicyScenario } from './mock-policy'
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
  mockPolicyApi.reset()
  mockGateApi.reset()
  resetMockOnboarding()
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
  ...mockProjectApi.api,
  ...mockPolicyApi.api,
  detectProviders: mockDetectProviders,
  testProviderConnection: mockTestConnection,
  // 2단계(T-038 설정 화면)에서 UI와 함께 시나리오를 확장한다. 그 전까지는 저장 없이 기본값만 돌려준다.
  getProviderSelection: async () => ({
    ok: true,
    value: { defaultProvider: 'claude', overrides: {} }
  }),
  saveProviderSelection: async (req) => ({ ok: true, value: req }),
  getWeeklyLimits: mockGetWeeklyLimits,
  saveWeeklyLimits: mockSaveWeeklyLimits,
  // 사용량 위젯 화면은 T-038(ui-dev)에서 시나리오 mock으로 바꾼다. 그 전까지는 빈 집계만 돌려준다.
  getUsageWidget: async () => ({
    ok: true,
    value: {
      windowStart: '2026-01-05T00:00:00.000Z',
      windowEnd: '2026-01-12T00:00:00.000Z',
      settings: { ...USAGE_SETTINGS_DEFAULT },
      providers: [],
      byProject: [],
      byEmployee: [],
      total: {
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        costUsd: null
      }
    }
  }),
  getUsageSettings: async () => ({ ok: true, value: { ...USAGE_SETTINGS_DEFAULT } }),
  saveUsageSettings: async (req) => ({ ok: true, value: req })
}
