import type { CompanyInfo } from '../../shared/company'
import type { Decision } from '../../shared/decision'
import type { OrgChart } from '../../shared/employee'
import type { Ticket } from '../../shared/ticket'

export const mockCompany: CompanyInfo = {
  name: 'Mock Company',
  dir: '/mock/Mock Company',
  mission: '# 미션\n\n작고 단단한 소프트웨어를 만든다.'
}

export const mockOrg: OrgChart = {
  employees: [
    {
      id: 'cto',
      name: 'cto',
      description: '기술 계획과 설계',
      department: 'R&D',
      reportsTo: null,
      title: 'CTO',
      model: 'opus',
      status: 'idle'
    },
    {
      id: 'cfo',
      name: 'cfo',
      description: '사용량과 예산 점검',
      department: '재무',
      reportsTo: null,
      title: 'CFO',
      model: 'sonnet',
      status: 'idle'
    },
    {
      id: 'pm',
      name: 'pm',
      description: '티켓 분해',
      department: '기획팀',
      reportsTo: null,
      title: 'PM',
      model: 'sonnet',
      status: 'waiting-approval'
    },
    {
      id: 'developer',
      name: 'developer',
      description: '범용 구현',
      department: '개발팀',
      reportsTo: 'cto',
      title: '개발자',
      model: 'sonnet',
      status: 'working'
    }
  ],
  departments: [
    { name: 'R&D', employeeIds: ['cto'] },
    { name: '재무', employeeIds: ['cfo'] },
    { name: '기획팀', employeeIds: ['pm'] },
    { name: '개발팀', employeeIds: ['developer'] }
  ]
}

export const mockTickets: Ticket[] = [
  {
    id: 'T-001',
    title: '로그인 화면',
    status: 'done',
    assignee: 'developer',
    body: '## 목표\n로그인 화면을 만든다.'
  },
  {
    id: 'T-002',
    title: '티켓 보드',
    status: 'in-progress',
    assignee: 'developer',
    body: '## 목표\n칸반 보드를 만든다.'
  },
  {
    id: 'T-003',
    title: '사용량 표시',
    status: 'backlog',
    assignee: null,
    body: '## 목표\n주간 사용량을 표시한다.'
  }
]

export const mockDecisions: Decision[] = [
  {
    id: 'D-001',
    title: 'T-002 푸시 승인',
    status: 'pending',
    ticketId: 'T-002',
    question: 'feature/T-002를 푸시하고 PR을 올릴까요?',
    options: [
      { key: 'A', label: '승인', description: '푸시하고 PR 생성' },
      { key: 'B', label: '거절', description: '보류' }
    ],
    recommended: 'A',
    chosen: null,
    memo: ''
  },
  {
    id: 'D-000',
    title: '초기 결정',
    status: 'done',
    ticketId: null,
    question: '기본 제공자는?',
    options: [{ key: 'A', label: 'Claude', description: 'Claude Code CLI' }],
    recommended: 'A',
    chosen: 'A',
    memo: ''
  }
]
