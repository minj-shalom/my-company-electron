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
    id: 'reviewer-qa',
    title: 'QA',
    department: '개발팀',
    role: '읽기 전용 검수',
    description: '구현 결과를 읽기만 하고 문제를 찾아 알려 줘요.',
    model: 'sonnet',
    tools: ['Read', 'Grep', 'Glob'],
    body: '# QA\n'
  },
  {
    id: 'designer',
    title: '디자이너',
    department: '디자인팀',
    role: '화면·시각 설계',
    description: '화면 구성과 시각 디자인을 정리해요.',
    model: 'sonnet',
    tools: ['Read', 'Write', 'Edit', 'Grep', 'Glob'],
    body: '# 디자이너\n'
  },
  {
    id: 'pm-dev',
    title: '개발 PM',
    department: '기획팀',
    role: '개발 프로젝트 관리',
    description: '티켓을 나누고 브랜치와 검수 흐름을 챙겨요.',
    model: 'sonnet',
    tools: ['Read', 'Write', 'Edit', 'Grep', 'Glob'],
    body: '# 개발 PM\n'
  },
  {
    id: 'pm-content',
    title: '콘텐츠 PM',
    department: '기획팀',
    role: '콘텐츠 프로젝트 관리',
    description: '하루 산출 계획과 승인 흐름을 챙겨요.',
    model: 'sonnet',
    tools: ['Read', 'Write', 'Edit', 'Grep', 'Glob'],
    body: '# 콘텐츠 PM\n'
  },
  {
    id: 'writer',
    title: '작가',
    department: '콘텐츠팀',
    role: '글 초안 작성',
    description: '글 초안을 써요. 승인 전에는 발행하지 않아요.',
    model: 'sonnet',
    tools: ['Read', 'Write', 'Edit', 'Grep', 'Glob'],
    body: '# 작가\n'
  },
  {
    id: 'editor',
    title: '편집자',
    department: '콘텐츠팀',
    role: '초안 검토',
    description: '초안을 다듬고 검토해요.',
    model: 'sonnet',
    tools: ['Read', 'Write', 'Edit', 'Grep', 'Glob'],
    body: '# 편집자\n'
  },
  {
    id: 'script-writer',
    title: '대본 작가',
    department: '콘텐츠팀',
    role: '대본 초안 작성',
    description: '영상 대본 초안을 써요.',
    model: 'sonnet',
    tools: ['Read', 'Write', 'Edit', 'Grep', 'Glob'],
    body: '# 대본 작가\n'
  },
  {
    id: 'researcher',
    title: '리서처',
    department: '리서치팀',
    role: '자료 조사',
    description: '필요한 자료를 찾아 요약해요.',
    model: 'sonnet',
    tools: ['Read', 'Write', 'Edit', 'Grep', 'Glob'],
    body: '# 리서처\n'
  },
  {
    id: 'content-planner',
    title: '콘텐츠 기획자',
    department: '콘텐츠팀',
    role: '콘텐츠 기획',
    description: '어떤 콘텐츠를 언제 낼지 계획해요.',
    model: 'sonnet',
    tools: ['Read', 'Write', 'Edit', 'Grep', 'Glob'],
    body: '# 콘텐츠 기획자\n'
  },
  {
    id: 'blog-writer',
    title: '블로그 작가',
    department: '콘텐츠팀',
    role: '블로그 글 작성',
    description: '블로그 글 초안을 써요. 올리기 전에 승인을 받아요.',
    model: 'sonnet',
    tools: ['Read', 'Write', 'Edit', 'Grep', 'Glob'],
    body: '# 블로그 작가\n'
  },
  {
    id: 'video-planner',
    title: '영상 기획자',
    department: '콘텐츠팀',
    role: '영상 기획',
    description: '영상 주제와 구성안, 대본을 만들어요.',
    model: 'sonnet',
    tools: ['Read', 'Write', 'Edit', 'Grep', 'Glob'],
    body: '# 영상 기획자\n'
  },
  {
    id: 'video-editor',
    title: '영상 편집자',
    department: '콘텐츠팀',
    role: '영상 편집 계획',
    description: '편집 순서와 자막 등 편집 계획을 정리해요.',
    model: 'sonnet',
    tools: ['Read', 'Write', 'Edit', 'Grep', 'Glob'],
    body: '# 영상 편집자\n'
  },
  {
    id: 'sns-marketer',
    title: 'SNS 마케터',
    department: '콘텐츠팀',
    role: 'SNS 게시물 작성',
    description: 'SNS 게시물 초안을 써요. 올리기 전에 승인을 받아요.',
    model: 'sonnet',
    tools: ['Read', 'Write', 'Edit', 'Grep', 'Glob'],
    body: '# SNS 마케터\n'
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
