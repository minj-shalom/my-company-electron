import type {
  CompanyCreateRequest,
  CompanyCreateResult,
  CompanyFolderPurpose,
  CompanyInfo,
  CompanyOpenRequest,
  CompanyOpenResult,
  CompanySelectFolderResult,
  CompanyState
} from './company'
import type { Decision, DecisionList, DecisionResolveRequest } from './decision'
import type {
  EmployeeChangeResult,
  EmployeeCreateRequest,
  EmployeeMoveRequest,
  EmployeeRetireRequest,
  EmployeeTemplateInfo,
  EmployeeUpdateRequest
} from './employee-change'
import type { OrgChart } from './employee'
import type { FirstHireRequest, FirstHireResult, HirePmResult } from './company-hire'
import type { OrgSnapshot } from './org'
import type {
  PolicyGetRequest,
  PolicySaveRequest,
  PolicySaveResult,
  PolicyState,
  PolicySummary
} from './policy'
import type {
  EmployeeProjectsRequest,
  EmployeeProjectsResult,
  ProjectAddRequest,
  ProjectAssignEmployeeRequest,
  ProjectChangeResult,
  ProjectIdRequest,
  ProjectList,
  ProjectRenameRequest,
  ProjectSelectFolderResult,
  ProjectSetPmRequest,
  ProjectSetTypeRequest
} from './project'
import type {
  ConnectionTestResult,
  ProviderCliId,
  ProviderDetection,
  WeeklyLimit,
  WeeklyLimitsSaveRequest
} from './provider'
import type { ApiResult } from './result'
import type {
  Ticket,
  TicketCreateRequest,
  TicketList,
  TicketMoveRequest,
  TicketStatus,
  TicketUpdateRequest
} from './ticket'
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
  /**
   * main의 폴더 선택 다이얼로그. 용도 기본값은 'create-location'. 취소하면 null.
   * createCompany/openCompany는 여기서 돌려받은 경로만 받는다 (직접 입력 불가).
   */
  selectCompanyFolder: (purpose?: CompanyFolderPurpose) => Promise<CompanySelectFolderResult>
  /** 기존 회사 폴더(또는 방금 만든 회사)를 연다. 표식이 없으면 거부하고 어떤 파일도 쓰지 않는다. 이미 다른 회사가 열려 있으면 `already-open`. */
  openCompany: (req: CompanyOpenRequest) => Promise<CompanyOpenResult>
  /** 열린 회사 상태. 앱 시작 시 마지막 회사를 자동으로 연 결과를 포함한다. */
  getCurrentCompany: () => Promise<CompanyState>
  /**
   * 도메인 조회/쓰기. 열린 회사(main이 보관)를 대상으로 한다. 실패는 예외가 아니라 ApiResult로 돌려준다.
   * main 핸들러가 없는 환경에서는 `not-implemented`를 돌려준다.
   */
  getCompany: () => Promise<ApiResult<CompanyInfo | null>>
  listEmployees: () => Promise<ApiResult<OrgChart>>
  /** 조직도(T-011) 계약. main이 열린 회사에서 읽어 돌려주며 열린 회사가 없으면 `no-company`. 파싱 문제는 실패가 아니라 `org.issues`에 담긴다. */
  getOrg: () => Promise<ApiResult<OrgSnapshot>>
  /** 읽지 못한 티켓(손상, 너무 큼, 중복 id)은 `unreadable`로 알리고 나머지는 `items`로 돌려준다. 담당이 비거나 조직에 없는 티켓도 정상이다. */
  listTickets: (status?: TicketStatus) => Promise<ApiResult<TicketList>>
  /** main은 id를 `^T-\d{1,6}$`만 받고, 경로를 id로 조합하지 않고 폴더 목록에서 찾아 쓴다. body는 마크다운이므로 renderer가 sanitize한다. */
  getTicket: (id: string) => Promise<ApiResult<Ticket>>
  /** 티켓을 다른 상태로 옮긴다 (마크다운 파일 이동 + 상태 줄 갱신). 이미 그 상태면 변경 없이 ok, 대상에 다른 파일이 있으면 `conflict`. */
  moveTicket: (req: TicketMoveRequest) => Promise<ApiResult<Ticket>>
  /**
   * 티켓 생성·편집 (T-044, 화면은 2단계). 쓰기는 회사 폴더 `company/tickets/backlog/`에만, 직렬화 큐로 한다.
   * 검증 규칙은 `TicketCreateRequest`/`TicketUpdateRequest` 주석 참고. 실패 코드: 입력 오류 `invalid-request`, 티켓 없음 `not-found`,
   * in-progress/done 편집 `forbidden`, 외부 수정·파일명 충돌 `conflict`. 오류 문구는 고정 문구이며 경로를 담지 않는다.
   */
  createTicket: (req: TicketCreateRequest) => Promise<ApiResult<Ticket>>
  updateTicket: (req: TicketUpdateRequest) => Promise<ApiResult<Ticket>>
  /** 읽지 못한 카드(손상, 너무 큼, 중복 id)는 `unreadable`로 알린다. 같은 id가 pending과 done에 있으면 done만 `items`에 둔다. */
  listDecisions: (status?: Decision['status']) => Promise<ApiResult<DecisionList>>
  /**
   * 결정 카드를 승인/거절한다 (pending -> done). main 검증 규칙은 DecisionResolveRequest 주석 참고.
   * 도메인 쓰기 채널은 `resolveDecision`, `moveTicket`과 직원 변경 4종(`createEmployee`, `updateEmployee`,
   * `moveEmployee`, `retireEmployee`, T-035)이다. 모두 열린 회사 폴더 안에서만, 직렬화 큐로 쓴다.
   */
  resolveDecision: (req: DecisionResolveRequest) => Promise<ApiResult<Decision>>
  /**
   * 직원 채용·수정·이동·퇴사 (T-035, 화면은 T-039). 호출자는 main이 항상 `ceo-ui`로 처리하고 요청에 `actor`는 없다 (알 수 없는 키는 거부).
   * 민감 변경(COO·CTO·CFO·hr 변경, 직원 삭제, tools 확대)은 승인된(done) 결정 카드 번호 `approval`이 없으면 `approval-required`,
   * 보호 직원(COO, CEO)은 `forbidden`, 이름 중복은 `conflict`. 오류 문구는 고정 문구이며 경로를 담지 않는다.
   * 직원 템플릿은 앱 번들 상수다. 직원 파일은 회사 폴더 `.claude/agents/`에만 쓴다.
   */
  listEmployeeTemplates: () => Promise<ApiResult<EmployeeTemplateInfo[]>>
  createEmployee: (req: EmployeeCreateRequest) => Promise<ApiResult<EmployeeChangeResult>>
  updateEmployee: (req: EmployeeUpdateRequest) => Promise<ApiResult<EmployeeChangeResult>>
  moveEmployee: (req: EmployeeMoveRequest) => Promise<ApiResult<EmployeeChangeResult>>
  /** 직원 파일을 `company/archive/employees/`로 옮기고 표에서 행을 지운다 (삭제하지 않는다). */
  retireEmployee: (req: EmployeeRetireRequest) => Promise<ApiResult<EmployeeChangeResult>>
  /**
   * PM 한 명을 바로 채용한다 (T-051). 입력 없음. 이미 PM 직급 직원이 있으면 `conflict`로 거부하니 기존 PM을 선택하게 안내한다.
   * 프로젝트의 `PM:` 줄은 이 호출이 건드리지 않는다. 반환된 `employeeId`로 호출 쪽이 `project:set-pm`(T-037)을 부른다.
   */
  hirePm: () => Promise<ApiResult<HirePmResult>>
  /**
   * 첫 채용 (T-051). pm, developer를 순서대로 채용한다. 이미 있으면 건너뛰고(`skipped`), 중간에 실패하면 이번 호출에서 채용한 직원을 모두 되돌린다.
   */
  firstHire: (req?: FirstHireRequest) => Promise<ApiResult<FirstHireResult>>
  /**
   * 프로젝트 관리 (T-037, 화면은 2단계). 원본은 회사 폴더의 `company/project.md`이고 모든 호출은 열린 회사 대상이다 (없으면 `no-company`).
   * 호출자는 main이 항상 `ceo-ui`로 처리한다 (요청에 `actor`는 없다). 오류 문구는 고정 문구이며 경로를 담지 않는다.
   * `selectProjectFolder`는 main의 폴더 선택 다이얼로그(새 폴더 만들기 허용)이고 취소하면 value가 null이다.
   * `addProject`는 여기서 돌려받은 경로만 받는다 (직접 입력은 `path-not-allowed`). 경로 규칙 위반, 이름 중복, development의 git 검증 실패는 `invalid-request`/`conflict`.
   * 보관(`archiveProject`)은 `project.md`의 상태만 바꾸며 폴더는 건드리지 않는다. 진행 중 티켓이 있으면 `conflict`.
   * 담당 PM은 org.md의 PM 직급 직원만 지정할 수 있고(`setProjectPm`), 목록의 `state`가 `pm-required`면 티켓 실행 대상이 아니다.
   * "현재 프로젝트"는 데이터가 아닌 UI 필터라 이 계약에 없다.
   */
  selectProjectFolder: () => Promise<ApiResult<ProjectSelectFolderResult>>
  listProjects: () => Promise<ApiResult<ProjectList>>
  addProject: (req: ProjectAddRequest) => Promise<ApiResult<ProjectChangeResult>>
  renameProject: (req: ProjectRenameRequest) => Promise<ApiResult<ProjectChangeResult>>
  archiveProject: (req: ProjectIdRequest) => Promise<ApiResult<ProjectChangeResult>>
  restoreProject: (req: ProjectIdRequest) => Promise<ApiResult<ProjectChangeResult>>
  /** development -> content/other는 바로, content/other -> development는 git 검증을 다시 통과해야 한다. */
  setProjectType: (req: ProjectSetTypeRequest) => Promise<ApiResult<ProjectChangeResult>>
  setProjectPm: (req: ProjectSetPmRequest) => Promise<ApiResult<ProjectChangeResult>>
  clearProjectPm: (req: ProjectIdRequest) => Promise<ApiResult<ProjectChangeResult>>
  /**
   * 프로젝트 배정 (T-045). 원본은 `company/project.md` 프로젝트 블록의 `직원:`(일반 배정)과 `PM:`(담당 PM) 줄이다.
   * `assignProjectEmployee`/`unassignProjectEmployee`는 멱등이며 `employeeId`는 org.md의 직원 파일 id다. 담당 PM은 이 호출이 아니라 `setProjectPm`/`clearProjectPm`을 쓴다.
   * 거부: CEO/COO는 `forbidden`, 조직도에 없는 직원·프로젝트는 `not-found`, 보관된 프로젝트 배정·이미 PM인 직원의 배정·PM 직원의 일반 해제는 `conflict`.
   * 결과의 `stateAfter`가 `pm-required`면 그 프로젝트는 PM 필요 상태다 (`clearProjectPm`, 대체 PM 없는 변경 뒤 확인 대화에 사용).
   * `listEmployeeProjects`는 직원 한 명의 담당 프로젝트(PM 먼저, 보관 프로젝트는 `active: false`)와 경고를 돌려준다. 퇴사는 배정이 있으면 `conflict`.
   * 배정은 `getOrg().agents[].projects`에도 합쳐져 있다 (필드가 없으면 미배정).
   */
  assignProjectEmployee: (
    req: ProjectAssignEmployeeRequest
  ) => Promise<ApiResult<ProjectChangeResult>>
  unassignProjectEmployee: (
    req: ProjectAssignEmployeeRequest
  ) => Promise<ApiResult<ProjectChangeResult>>
  listEmployeeProjects: (req: EmployeeProjectsRequest) => Promise<ApiResult<EmployeeProjectsResult>>
  /**
   * 프로젝트 작업 흐름 정책 (T-047). 원본은 `company/policies/<프로젝트 id>.md`이고 id는 등록된 프로젝트만 허용한다 (아니면 `not-found`).
   * `getPolicy`: 정책이 없으면 `exists: false`와 보수적 기본값(모든 동작 `every`)을 돌려준다. `values`는 편집용, `effective`는 실제 적용값(유효하지 않은 `auto`는 `every`로 대체), `warnings`는 직접 편집된 이상한 값, `history`는 변경 이력(최신이 마지막)이다.
   * `savePolicy`: `getPolicy`가 준 `revision`과 편집한 `values` 전체를 보낸다. 규칙 위반은 오류가 아니라 `{ saved: false, violations: [{ code, field?, message }] }`로 돌려주고 파일은 바뀌지 않는다. 다른 곳에서 바뀌었으면 `conflict`, 형식 오류는 `invalid-request`.
   * 자동(`auto`) 모드는 일일 상한과 허용 대상이 있어야 하고, 켜거나 바꿀 때는 경고 대화 확인 뒤 `confirmAuto: true`를 보내야 한다 (없으면 `auto-needs-confirm`). 보호 브랜치(master, main 등) 자동 머지는 상한 1~2, `confirmInput`이 프로젝트 이름과 같아야 한다.
   * `listPolicySummaries`: 프로젝트별 자동 모드 동작 목록 (배지, 방문 요약). 자동 모드의 실행 시 강제는 이 API가 아니라 T-053 게이트가 한다.
   */
  getPolicy: (req: PolicyGetRequest) => Promise<ApiResult<PolicyState>>
  savePolicy: (req: PolicySaveRequest) => Promise<ApiResult<PolicySaveResult>>
  listPolicySummaries: () => Promise<ApiResult<PolicySummary[]>>
  /**
   * 온보딩(T-009) 계약 (T-034에서 main에 연결됨).
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
  companyOpen: 'company:open',
  companyCurrent: 'company:current',
  // companyGet~employeeList는 계약만 정의한다. main 핸들러가 생기기 전까지 preload는 이 채널을 호출하지 않는다.
  companyGet: 'company:get',
  employeeList: 'employee:list',
  orgGet: 'org:get',
  ticketList: 'ticket:list',
  ticketGet: 'ticket:get',
  ticketMove: 'ticket:move',
  ticketCreate: 'ticket:create',
  ticketUpdate: 'ticket:update',
  decisionList: 'decision:list',
  decisionResolve: 'decision:resolve',
  employeeListTemplates: 'employee:list-templates',
  employeeCreate: 'employee:create',
  employeeUpdate: 'employee:update',
  employeeMove: 'employee:move',
  employeeRetire: 'employee:retire',
  companyHirePm: 'company:hire-pm',
  companyFirstHire: 'company:first-hire',
  projectSelectFolder: 'project:select-folder',
  projectList: 'project:list',
  projectAdd: 'project:add',
  projectRename: 'project:rename',
  projectArchive: 'project:archive',
  projectRestore: 'project:restore',
  projectSetType: 'project:set-type',
  projectSetPm: 'project:set-pm',
  projectClearPm: 'project:clear-pm',
  projectAssignEmployee: 'project:assign-employee',
  projectUnassignEmployee: 'project:unassign-employee',
  employeeProjects: 'employee:projects',
  policyGet: 'policy:get',
  policySave: 'policy:save',
  policyListSummaries: 'policy:list-summaries',
  providerDetect: 'provider:detect',
  providerTestConnection: 'provider:test-connection',
  settingsWeeklyLimitsGet: 'settings:weekly-limits-get',
  settingsWeeklyLimitsSave: 'settings:weekly-limits-save'
} as const
