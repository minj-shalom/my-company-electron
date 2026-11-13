import type { OrgModel } from '../../shared/org'
import type { PolicyState } from '../../shared/policy'
import type { ProjectInfo } from '../../shared/project'
import type { Ticket } from '../../shared/ticket'
import type { GateRunLaunch, GateRunRequest } from '../gate/tool-bridge'
import type { ProviderAdapter } from '../providers/types'

/** 틱 한 번이 읽는 회사 상태. 파일이 원본이고 이것은 틱 시작 시점의 사본이다. */
export interface TickSnapshot {
  /** 진행 중 티켓이 앞, 백로그가 뒤. 각각 번호 순. */
  tickets: Ticket[]
  /** 조직도를 읽지 못했으면 null. 이 경우 프로젝트는 보수적으로 "PM 필요"가 된다. */
  org: OrgModel | null
  /** 프로젝트 목록(T-037)을 읽지 못했으면 null. 프로젝트 티켓은 실행하지 않는다. */
  projects: ProjectInfo[] | null
  /** `employee:quarantined`(T-052)에 있는 직원 id. */
  quarantined: ReadonlySet<string>
}

export type HrRequestKind = 'hire' | 'pm-required' | 'pm-add'

export interface HrRequestInput {
  kind: HrRequestKind
  /** 같은 사유의 요청이 틱마다 쌓이지 않게 하는 키. 구현(T-052)이 중복을 걸러낸다. */
  idemKey: string
  ticketId: string | null
  projectId: string | null
  /** 사람이 읽는 한 줄 사유(한국어). 자격 증명·경로를 담지 않는다. */
  reason: string
}

export interface AssignmentProposalInput {
  idemKey: string
  projectId: string
  employeeId: string
  ticketId: string
}

/** 인사 요청·제안 카드 연결점(T-046/T-052). 없으면 브리핑에만 적는다. */
export interface TickRequests {
  requestHr(input: HrRequestInput): Promise<void>
  proposeAssignment(input: AssignmentProposalInput): Promise<void>
}

/** 어댑터를 만들 때 함께 넘기는 실행 귀속 정보. 사용량 기록(T-019)이 프로젝트·티켓을 남기는 데 쓴다. */
export interface TickRunInfo {
  ticketId: string
  /** 회사 공통 티켓이면 null. */
  projectId: string | null
}

export interface LimitCheck {
  /** false면 실행하지 않는다. */
  ok: boolean
  /** true면 점검 쪽이 이미 결정 카드를 관리하므로(중복 방지 포함) 틱이 한도 카드를 따로 만들지 않는다. */
  cardHandled?: boolean
  /** 브리핑과 카드에 쓰는 한국어 사유. */
  reason: string
}

export interface DecisionCardInput {
  title: string
  ticketId: string | null
  question: string
  impact: string
}

export interface TickDeps {
  now: () => Date
  /** 회사 폴더 절대 경로(realpath). COO와 회사 공통 티켓의 cwd. */
  companyDir: () => string
  loadSnapshot: () => Promise<TickSnapshot>
  /** 프로젝트 정책. 읽지 못하면 null이고 가장 보수적인 지침이 쓰인다. */
  loadPolicy: (projectId: string) => Promise<PolicyState | null>
  /** 직원 파일 본문(프롬프트). 없으면 null. */
  readAgentPrompt: (employeeId: string) => Promise<string | null>
  /**
   * T-037에 등록된 프로젝트의 실제 폴더. 등록되지 않았거나 안전하지 않으면 null.
   * 자유 경로를 받지 않는다. 호출 측은 프로젝트 id만 넘긴다.
   */
  resolveProjectDir: (projectId: string) => Promise<string | null>
  /** cwd마다 어댑터를 만든다 (어댑터의 cwd는 생성 시 고정). 실행은 spawn + 인자 배열이다. */
  createAdapter: (cwd: string, employeeId?: string, run?: TickRunInfo) => ProviderAdapter
  /** `company/reports/<id>.md`에 쓴다 (SafeFs, 덮어쓰기 없음). 같은 id가 있으면 false. */
  writeReport: (id: string, markdown: string) => Promise<'written' | 'exists'>
  createCard: (input: DecisionCardInput) => Promise<string>
  /** 프로젝트(또는 null=회사 전체) 킬 스위치. 읽지 못하면 true로 답해야 한다. */
  isKillSwitchEngaged?: (projectId: string | null) => Promise<boolean>
  /**
   * CFO 한도 점검(T-019). 주입이 없거나 던지면 실행하지 않는다 (가장 보수적).
   * 반복 업무로 생긴 티켓(T-049)도 같은 점검을 통과해야 한다.
   */
  /** 이번 틱에서 실제로 실행할 직원 id들(티켓 담당, hr 실행)을 받아 그 직원의 제공자 기준으로만 점검한다. */
  checkLimit?: (employeeIds: readonly string[]) => Promise<LimitCheck>
  /** T-052 도구 브리지 연결(T-053 게이트). 없거나 실패하면 모든 동작은 `매번 컨펌`이고 푸시·머지·발행 도구는 없다. */
  prepareToolRun?: (
    req: GateRunRequest,
    provider: { toolBridge: boolean }
  ) => Promise<GateRunLaunch>
  requests?: TickRequests
  /** hr 전용 실행(T-052) 연결점. 대기 중인 요청이 있을 때만 run을 부른다. COO 세션에서 hr을 부르지 않는다. */
  hr?: { pending: () => Promise<number>; run: (signal: AbortSignal) => Promise<void> }
  /** 실행 한 번의 시간 상한(ms). */
  timeoutMs?: number
}
