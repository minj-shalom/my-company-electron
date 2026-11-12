import type {
  CompanyCreateRequest,
  CompanyCreateResult,
  CompanyInfo,
  CompanySelectFolderResult
} from './company'
import type { Decision, DecisionResolveRequest } from './decision'
import type { OrgChart } from './employee'
import type { ApiResult } from './result'
import type { Ticket, TicketStatus } from './ticket'
import type { RunEvent, RunStartRequest, RunStartResult } from './run'

/** main/preload/renderer 공용 `window.api` 계약. 채널을 추가하면 여기와 preload를 함께 갱신한다. */
export interface WindowApi {
  /** IPC 왕복 확인용. main이 'pong'을 돌려준다. */
  ping: () => Promise<string>
  /** claude CLI 실행을 시작한다. 이벤트는 onRunEvent로 받는다. */
  startRun: (req: RunStartRequest) => Promise<RunStartResult>
  /** 실행 중인 run을 취소한다. 대상이 없으면 false. */
  cancelRun: (runId: string) => Promise<boolean>
  /** 새 회사 폴더(구조 + 기본 템플릿)를 만든다. 기존 폴더는 덮어쓰지 않는다. */
  createCompany: (req: CompanyCreateRequest) => Promise<CompanyCreateResult>
  /** 회사 폴더를 만들 위치를 main의 폴더 선택 다이얼로그로 고른다. 취소하면 null. */
  selectCompanyFolder: () => Promise<CompanySelectFolderResult>
  /**
   * 도메인 조회/쓰기. 열린 회사(main이 보관)를 대상으로 한다. 실패는 예외가 아니라 ApiResult로 돌려준다.
   * main 핸들러가 없는 환경에서는 `not-implemented`를 돌려준다.
   */
  getCompany: () => Promise<ApiResult<CompanyInfo | null>>
  listEmployees: () => Promise<ApiResult<OrgChart>>
  listTickets: (status?: TicketStatus) => Promise<ApiResult<Ticket[]>>
  getTicket: (id: string) => Promise<ApiResult<Ticket>>
  listDecisions: (status?: Decision['status']) => Promise<ApiResult<Decision[]>>
  /** 결정 카드를 승인/거절한다 (pending -> done). 도메인 쓰기는 이것 하나뿐이다. */
  resolveDecision: (req: DecisionResolveRequest) => Promise<ApiResult<Decision>>
  /** run 이벤트 구독. 반환된 함수로 해제한다. */
  onRunEvent: (listener: (event: RunEvent) => void) => () => void
}

/** IPC 채널명 (`도메인:동작`). */
export const IPC_CHANNELS = {
  ping: 'app:ping',
  runStart: 'run:start',
  runCancel: 'run:cancel',
  runEvent: 'run:event',
  companyCreate: 'company:create',
  companySelectFolder: 'company:select-folder',
  // 아래 채널은 계약만 정의한다. main 핸들러가 생기기 전까지 preload는 이 채널을 호출하지 않는다.
  companyGet: 'company:get',
  employeeList: 'employee:list',
  ticketList: 'ticket:list',
  ticketGet: 'ticket:get',
  decisionList: 'decision:list',
  decisionResolve: 'decision:resolve'
} as const
