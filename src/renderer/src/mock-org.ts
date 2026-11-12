import type { WindowApi } from '../../shared/api'
import type { OrgAgentDetail, OrgMember, OrgSnapshot, OrgTreeNode } from '../../shared/org'

/** 브라우저 개발 모드 전용. `?mock-org=empty|error|loading|issues|many`로 상태를 바꿔 화면을 확인한다. */
export type OrgScenario = 'normal' | 'empty' | 'error' | 'loading' | 'issues' | 'blocking' | 'many'
const SCENARIOS: readonly OrgScenario[] = [
  'normal',
  'empty',
  'error',
  'loading',
  'issues',
  'blocking',
  'many'
]

export function parseOrgScenario(search: string): OrgScenario {
  const v = new URLSearchParams(search).get('mock-org')
  return SCENARIOS.find((s) => s === v) ?? 'normal'
}

const member = (
  title: string,
  kind: OrgMember['kind'],
  agentId: string | null,
  department: string | null,
  reportsTo: string | null,
  role: string,
  fileExists = true
): OrgMember => ({ title, kind, agentId, fileExists, department, reportsTo, role })

const MEMBERS: OrgMember[] = [
  member('CEO', 'human', null, '경영', null, '비전·미션 설정, 최종 결정'),
  member('COO', 'main-session', null, '경영', 'CEO', '부서에 업무 하달, 진행 관리, CEO 보고'),
  member('CTO', 'agent', 'cto', 'R&D', 'COO', '기술 계획, 설계, 기술 검토'),
  member('CFO', 'agent', 'cfo', '재무', 'COO', 'Claude Code 사용량·예산 관리'),
  member('PM', 'agent', 'pm', '기획팀', 'COO', '목표를 티켓으로 분해, 우선순위'),
  member('개발자', 'agent', 'developer', '개발팀', 'CTO', '범용 구현'),
  member('UI 개발자', 'agent', 'ui-dev', '개발팀', 'CTO', 'React UI, 가상 사무실, 티켓 보드'),
  member('QA', 'agent', 'reviewer-qa', '개발팀', 'CTO', '읽기 전용 검수'),
  member('DevOps', 'agent', 'devops', '개발팀', 'CTO', '패키징, 서명/공증', false)
]

const node = (title: string, children: OrgTreeNode[] = []): OrgTreeNode => ({
  member: MEMBERS.find((m) => m.title === title) as OrgMember,
  children
})

const AGENTS: OrgAgentDetail[] = [
  {
    id: 'cto',
    name: 'cto',
    description: '기술 계획·설계·기술 검토',
    model: 'opus',
    tools: ['Read', 'Grep', 'Glob', 'Bash']
  },
  {
    id: 'cfo',
    name: 'cfo',
    description: '사용량과 예산 점검',
    model: 'sonnet',
    tools: ['Read', 'Bash']
  },
  {
    id: 'pm',
    name: 'pm',
    description: '목표를 티켓으로 분해',
    model: 'sonnet',
    tools: ['Read', 'Write', 'Edit']
  },
  {
    id: 'developer',
    name: 'developer',
    description: '범용 구현',
    model: 'sonnet',
    tools: ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob']
  },
  // 일부러 model/tools가 없는 직원: 빈 값 처리를 확인한다.
  { id: 'ui-dev', name: 'ui-dev', description: 'React UI 구현', model: null, tools: [] },
  {
    id: 'reviewer-qa',
    name: 'reviewer-qa',
    description: '읽기 전용 검수',
    model: 'sonnet',
    tools: ['Read', 'Grep', 'Glob']
  }
]

const DEPT_NAMES = ['경영', 'R&D', '재무', '기획팀', '개발팀']

const NORMAL: OrgSnapshot = {
  org: {
    members: MEMBERS,
    departments: DEPT_NAMES.map((name) => ({
      name,
      members: MEMBERS.filter((m) => m.department === name).map((m) => m.title)
    })),
    tree: [
      node('CEO', [
        node('COO', [
          node('CTO', [node('개발자'), node('UI 개발자'), node('QA'), node('DevOps')]),
          node('CFO'),
          node('PM')
        ])
      ])
    ],
    chart: [],
    issues: []
  },
  agents: AGENTS
}

/** 직원 20명, 부서 6개. 맵 성능과 방 배치가 부서/직원 수에 따라 늘어나는지 확인하는 시나리오. */
function manySnapshot(): OrgSnapshot {
  const depts = ['경영', 'R&D', '재무', '기획팀', '개발팀', '운영팀']
  const sizes = [2, 3, 2, 3, 6, 4]
  const members: OrgMember[] = depts.flatMap((dept, d) =>
    Array.from({ length: sizes[d] }, (_, i) =>
      member(
        d === 0 && i === 0 ? 'CEO' : `${dept} ${i + 1}`,
        d === 0 && i === 0 ? 'human' : 'agent',
        d === 0 && i === 0 ? null : `agent-${d}-${i}`,
        dept,
        d === 0 && i === 0 ? null : 'CEO',
        `${dept} 업무 ${i + 1}`
      )
    )
  )
  return {
    org: {
      members,
      departments: depts.map((name) => ({
        name,
        members: members.filter((m) => m.department === name).map((m) => m.title)
      })),
      tree: [
        { member: members[0], children: members.slice(1).map((m) => ({ member: m, children: [] })) }
      ],
      chart: [],
      issues: []
    },
    agents: []
  }
}

function scenarioSnapshot(s: OrgScenario): OrgSnapshot {
  if (s === 'many') return manySnapshot()
  const snap = structuredClone(NORMAL)
  if (s === 'empty')
    return { org: { ...snap.org, members: [], departments: [], tree: [] }, agents: [] }
  if (s === 'issues')
    snap.org.issues = [
      { code: 'missing-agent-file', message: 'x', line: 18 },
      { code: 'unknown-reports-to', message: 'x', line: 12 }
    ]
  if (s === 'blocking')
    snap.org.issues = [
      { code: 'file-too-large', message: 'x' },
      { code: 'cycle', message: 'x', line: 9 }
    ]
  return snap
}

export function mockGetOrg(scenario: OrgScenario): WindowApi['getOrg'] {
  return async () => {
    if (scenario === 'error')
      return { ok: false, code: 'internal', message: '조직도를 불러오지 못했습니다.' }
    // 로딩 화면을 오래 볼 수 있도록 사실상 응답하지 않는다.
    if (scenario === 'loading') await new Promise((r) => setTimeout(r, 600_000))
    return { ok: true, value: scenarioSnapshot(scenario) }
  }
}
