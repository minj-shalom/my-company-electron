import type {
  CompanyCreateRequest,
  CompanyCreateResult,
  CompanyInfo,
  CompanySelectFolderResult
} from './company'
import type { Decision, DecisionResolveRequest } from './decision'
import type { OrgChart } from './employee'
import type {
  ConnectionTestResult,
  ProviderCliId,
  ProviderDetection,
  WeeklyLimit,
  WeeklyLimitsSaveRequest
} from './provider'
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
  /** main은 id를 허용 형식(예: ^T-\d+$)만 받고, 경로를 id로 조합하지 말고 목록에서 찾아 쓴다. body는 마크다운이므로 renderer가 sanitize한다. */
  getTicket: (id: string) => Promise<ApiResult<Ticket>>
  listDecisions: (status?: Decision['status']) => Promise<ApiResult<Decision[]>>
  /** 결정 카드를 승인/거절한다 (pending -> done). 도메인 쓰기는 이것 하나뿐이다. main 검증 규칙은 DecisionResolveRequest 주석 참고. */
  resolveDecision: (req: DecisionResolveRequest) => Promise<ApiResult<Decision>>
  /**
   * 온보딩(T-009) 계약. main 핸들러는 후속 티켓에서 구현하며 그 전까지 preload는 `not-implemented`를 돌려준다.
   * 모든 입력은 main이 다시 검증한다 (provider는 PROVIDER_CLI_IDS 허용 목록, 한도는 validateWeeklyLimitAmount).
   */
  /** 세 제공자 CLI의 설치 여부를 확인한다. 사용량을 쓰지 않는다. */
  detectProviders: () => Promise<ApiResult<ProviderDetection[]>>
  /** 사용자가 `연결 테스트`를 눌렀을 때만 호출한다. 자동 호출 금지 (사용량이 든다). */
  testProviderConnection: (provider: ProviderCliId) => Promise<ApiResult<ConnectionTestResult>>
  /** 저장된 제공자별 주간 한도. 저장된 값이 없으면 빈 배열. */
  getWeeklyLimits: () => Promise<ApiResult<WeeklyLimit[]>>
  /** 주간 한도 전체를 교체 저장한다. 목록에 없는 제공자는 한도 없음. 토큰/인증 정보는 이 계약에 없다. */
  saveWeeklyLimits: (req: WeeklyLimitsSaveRequest) => Promise<ApiResult<WeeklyLimit[]>>
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
  decisionResolve: 'decision:resolve',
  providerDetect: 'provider:detect',
  providerTestConnection: 'provider:test-connection',
  settingsWeeklyLimitsGet: 'settings:weekly-limits-get',
  settingsWeeklyLimitsSave: 'settings:weekly-limits-save'
} as const
