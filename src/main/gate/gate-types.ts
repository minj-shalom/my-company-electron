import type { AuditResult } from '../../shared/gate'
import type { LimitedAction, PolicyState } from '../../shared/policy'
import type { ProjectState } from '../../shared/project'
import type { CommandRunner } from './command-runner'

/** 도구 서버가 실행(세션)마다 고정하는 호출 맥락. 도구 입력은 이 값을 바꿀 수 없다. */
export interface GateContext {
  projectId: string
  /** 호출 직원 id. 실행을 시작한 main 코드가 정한다. */
  employeeId: string
  ticketId: string | null
  /** 제공자가 도구 브리지를 지원하지 않으면 false (자동 모드 비활성, 항상 카드). */
  autoAllowed: boolean
}

export interface ProjectRuntime {
  /** 프로젝트 폴더 실제 경로 (등록 시 검증된 경로). */
  dir: string
  state: ProjectState
}

export interface PlanInput {
  ctx: GateContext
  project: ProjectRuntime
  policy: PolicyState
  runner: CommandRunner
  signal: AbortSignal
}

export type ExecOutcome = { ok: true } | { ok: false }

/** 자동 실행 후보 한 건. 읽기 전용 사전 점검을 마친 상태이고 `run`만 부수 효과가 있다. */
export interface GatePlan {
  action: LimitedAction
  /** 카드·감사에 쓰는 대상 표기 (브랜치/초안 경로 + 짧은 해시). */
  target: string
  /** 같은 대상·같은 내용이면 같은 키. 실제 ref나 해시를 포함해 같은 이름의 다른 내용은 다른 키가 된다. */
  idemKey: string
  /** 정책 허용 목록 밖이거나 조건 미충족이면 사유 코드. 자동은 실행하지 않고 카드로 대체한다. */
  fallback: {
    result: Extract<AuditResult, 'blocked-target' | 'blocked-review'>
    reason: string
  } | null
  /** 상한에 더 거는 값 (보호 브랜치 머지 등). */
  extraCap?: number
  run: () => Promise<ExecOutcome>
}

export type PlanOutcome = { kind: 'plan'; plan: GatePlan } | { kind: 'reject'; message: string }

export type Planner = (input: PlanInput, raw: unknown) => Promise<PlanOutcome>

/** 머지 전 `reviewer-qa` 통과 기록 확인. */
export interface ReviewChecker {
  passed(projectId: string, ticketId: string): Promise<boolean>
}
