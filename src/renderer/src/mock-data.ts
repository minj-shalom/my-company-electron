import type { CompanyInfo } from '../../shared/company'
import type { OrgChart } from '../../shared/employee'

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
