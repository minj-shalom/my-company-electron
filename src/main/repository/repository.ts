import type { CompanyInfo } from '../../shared/company'
import type { Decision, DecisionResolveRequest } from '../../shared/decision'
import type { Employee, OrgChart } from '../../shared/employee'
import type { Report } from '../../shared/report'
import type { ApiResult } from '../../shared/result'
import type { Ticket, TicketStatus } from '../../shared/ticket'

/** 파싱/읽기에 실패한 파일. 앱을 죽이지 않고 목록과 함께 보고한다. `path`는 회사 폴더 기준 상대 경로. */
export interface LoadIssue {
  path: string
  message: string
  /** 결정 카드 목록처럼 renderer에 분류만 알려야 할 때 쓴다. 없으면 `unreadable`로 본다. */
  reason?: 'unreadable' | 'duplicate' | 'too-large'
}

/** 목록 조회 결과. 정상 항목과 오류 항목을 함께 돌려준다. */
export interface Listing<T> {
  items: T[]
  issues: LoadIssue[]
}

export interface EmployeeInput {
  /** 파일명이 된다. 허용 형식: ^[a-z0-9][a-z0-9-]{0,49}$ */
  id: string
  name: string
  description: string
  tools?: string
  model?: string
  /** frontmatter 아래 마크다운 본문. */
  body?: string
}

/**
 * 데이터 접근 계층. 지금은 파일 기반 구현(`FileCompanyRepository`)만 있고,
 * 나중에 서버 구현으로 교체할 수 있도록 호출자는 이 인터페이스에만 의존한다.
 * 쓰기 메서드는 마크다운 원본을 먼저 갱신한다 (캐시는 원본에서 재생성되는 파생물).
 */
export interface CompanyRepository {
  getCompany(): Promise<ApiResult<CompanyInfo>>

  listEmployees(): Promise<{ org: OrgChart; issues: LoadIssue[] }>
  getEmployee(id: string): Promise<ApiResult<Employee>>
  /** 직원 파일을 새로 만들거나 갱신한다 (`.claude/agents/<id>.md`). */
  saveEmployee(input: EmployeeInput): Promise<ApiResult<Employee>>

  listTickets(status?: TicketStatus): Promise<Listing<Ticket>>
  getTicket(id: string): Promise<ApiResult<Ticket>>
  /** 티켓을 다른 상태 폴더로 옮기고 본문의 상태 줄을 갱신한다. */
  moveTicket(id: string, status: TicketStatus): Promise<ApiResult<Ticket>>

  listDecisions(status?: Decision['status']): Promise<Listing<Decision>>
  getDecision(id: string): Promise<ApiResult<Decision>>
  /** pending 카드에 선택과 메모를 적고 done으로 옮긴다. */
  resolveDecision(req: DecisionResolveRequest): Promise<ApiResult<Decision>>

  listReports(): Promise<Listing<Report>>
  getReport(id: string): Promise<ApiResult<Report>>
  /** 새 보고서를 쓴다. 같은 id가 있으면 conflict (덮어쓰지 않는다). */
  createReport(id: string, markdown: string): Promise<ApiResult<Report>>
}
