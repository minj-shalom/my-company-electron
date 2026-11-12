import type { WindowApi } from '../../shared/api'
import type { FirstHireRole } from '../../shared/company-hire'
import { FIRST_HIRE_ROLES } from '../../shared/company-hire'
import type { ChangeRecord, EmployeeTemplateInfo } from '../../shared/employee-change'
import type { ApiResult } from '../../shared/result'
import { mockOrgState } from './mock-org'

/**
 * 브라우저 개발 모드 전용. `?mock-hire=ok|conflict|fail|approval|slow`.
 * ok: 성공, conflict: 이미 있는 직원, fail: 내부 오류, approval: 승인 필요, slow: 응답이 느림(처리 중 상태 확인).
 */
export type HireScenario = 'ok' | 'conflict' | 'fail' | 'approval' | 'slow'
const SCENARIOS: readonly HireScenario[] = ['ok', 'conflict', 'fail', 'approval', 'slow']

export function parseHireScenario(search: string): HireScenario {
  const v = new URLSearchParams(search).get('mock-hire')
  return SCENARIOS.find((s) => s === v) ?? 'ok'
}

export const MOCK_TEMPLATES: EmployeeTemplateInfo[] = [
  {
    id: 'pm',
    title: 'PM',
    department: '기획팀',
    role: '목표를 티켓으로 분해, 우선순위',
    description: '프로젝트 목표를 티켓으로 나누고 우선순위와 진행 현황을 관리해요.',
    model: 'sonnet',
    tools: ['Read', 'Write', 'Edit'],
    body: '# PM\n'
  },
  {
    id: 'developer',
    title: '개발자',
    department: '개발팀',
    role: '범용 구현',
    description: '티켓에 맞춰 코드를 구현하고 테스트해요.',
    model: 'sonnet',
    tools: ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob'],
    body: '# 개발자\n'
  },
  {
    id: 'hr',
    title: '인사',
    department: '인사팀',
    role: '직원 채용, 직원 파일·조직도 정리',
    description: '직원 채용과 조직도 정리를 맡아요.',
    model: 'sonnet',
    tools: ['Read', 'Write', 'Edit', 'Grep', 'Glob'],
    body: '# 인사\n'
  }
]

type HireMockApi = Pick<
  WindowApi,
  'hirePm' | 'firstHire' | 'createEmployee' | 'listEmployeeTemplates'
>

const record = (employeeId: string, action: ChangeRecord['action'] = 'create'): ChangeRecord => ({
  action,
  employeeId,
  actor: 'ceo-ui',
  approval: null,
  sensitive: employeeId === 'hr',
  sensitiveReasons: employeeId === 'hr' ? ['protected-role'] : [],
  changedFields: ['file', 'row'],
  files: [`.claude/agents/${employeeId}.md`, 'company/org.md'],
  at: '2026-11-13T09:00:00.000Z'
})

const failure = (code: 'conflict' | 'internal' | 'approval-required'): ApiResult<never> => {
  const messages = {
    conflict: '같은 직원이 이미 있어요.',
    internal: '채용하지 못했어요.',
    'approval-required': '이 변경은 CEO 승인이 필요해요.'
  }
  return { ok: false, code, message: messages[code] }
}

export function createMockHireApi(scenario: HireScenario, delayMs: number): { api: HireMockApi } {
  const wait = (): Promise<void> =>
    new Promise((r) => setTimeout(r, scenario === 'slow' ? Math.max(delayMs, 1) * 5 : delayMs))
  const blocked = (): ApiResult<never> | null =>
    scenario === 'conflict'
      ? failure('conflict')
      : scenario === 'fail'
        ? failure('internal')
        : scenario === 'approval'
          ? failure('approval-required')
          : null

  return {
    api: {
      listEmployeeTemplates: async () => ({ ok: true, value: structuredClone(MOCK_TEMPLATES) }),
      hirePm: async () => {
        await wait()
        const f = blocked()
        if (f) return f
        if (mockOrgState.pm) return failure('conflict')
        mockOrgState.pm = true
        return { ok: true, value: { employeeId: 'pm', record: record('pm') } }
      },
      firstHire: async (req) => {
        await wait()
        const f = blocked()
        if (f) return f
        const wanted: FirstHireRole[] = FIRST_HIRE_ROLES.filter(
          (r) => !req?.roles || req.roles.includes(r)
        )
        const skipped = wanted.filter((r) => mockOrgState[r])
        const hired = wanted.filter((r) => !mockOrgState[r])
        for (const r of hired) mockOrgState[r] = true
        return { ok: true, value: { records: hired.map((r) => record(r)), skipped } }
      },
      createEmployee: async (req) => {
        await wait()
        const f = blocked()
        if (f) return f
        if (req.templateId !== 'hr')
          return { ok: false, code: 'not-implemented', message: '아직 지원하지 않는 기능입니다.' }
        mockOrgState.hr = true
        return { ok: true, value: { record: record('hr'), warnings: [] } }
      }
    }
  }
}
