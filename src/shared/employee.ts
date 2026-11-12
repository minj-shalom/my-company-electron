/** 직원/조직 타입. 원본은 회사 폴더의 `.claude/agents/*.md`와 `company/org.md`. */

export interface Employee {
  /** 에이전트 파일명(확장자 제외). 안정적인 식별자. */
  id: string
  name: string
  description: string
  /** org.md에서 읽은 부서. 없으면 null. */
  department: string | null
  /** org.md의 보고 대상 직원 id. 최상위(COO처럼 CEO에게 보고하거나 보고 대상이 사람인 경우)는 null. CEO는 직원이 아니므로 id로 쓰지 않는다. */
  reportsTo: string | null
  /** 표시용 직급 (예: CTO). */
  title: string | null
  model: string | null
  /** 실행 이벤트/티켓에서 파생된 현재 상태. */
  status: EmployeeStatus
}

export type EmployeeStatus = 'idle' | 'working' | 'waiting-approval'

export interface Department {
  name: string
  employeeIds: string[]
}

export interface OrgChart {
  employees: Employee[]
  departments: Department[]
}
