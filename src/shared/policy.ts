/** 프로젝트 작업 흐름 정책(T-047) 계약. 원본은 `company/policies/<프로젝트 id>.md`이고 이 구조는 파생물이다. */

export const POLICY_FLOWS = ['dev-git-pr', 'content-draft-approve', 'custom'] as const
export type PolicyFlow = (typeof POLICY_FLOWS)[number]

/** 동작 종류. push/merge는 개발 흐름, publish/draft-approve는 콘텐츠 흐름에서 쓴다. */
export const POLICY_ACTIONS = ['push', 'merge', 'publish', 'draft-approve'] as const
export type PolicyAction = (typeof POLICY_ACTIONS)[number]

/** every: 매번 컨펌(기본), batch: 묶음 컨펌, auto: CEO가 명시적으로 켠 자동 모드. */
export const APPROVAL_MODES = ['every', 'batch', 'auto'] as const
export type ApprovalMode = (typeof APPROVAL_MODES)[number]

/** 일일 상한이 필요한 자동 동작과 그 최대값 (보호 브랜치 머지는 `PROTECTED_MERGE_MAX_DAILY`). */
export const LIMITED_ACTIONS = ['push', 'merge', 'publish'] as const
export type LimitedAction = (typeof LIMITED_ACTIONS)[number]
export const MAX_DAILY_LIMIT: Record<LimitedAction, number> = { push: 50, merge: 10, publish: 20 }
export const PROTECTED_MERGE_MAX_DAILY = 2

export const REVIEW_STAGES = ['required', 'recommended'] as const
export type ReviewStage = (typeof REVIEW_STAGES)[number]

export const MAX_POLICY_BYTES = 64 * 1024
export const MAX_POLICY_MEMO = 500
export const MAX_DAILY_OUTPUT_GOAL = 20

/** 편집 가능한 정책 값 전체. UI는 get으로 받은 `values`를 고쳐서 그대로 save에 돌려보낸다. */
export interface PolicyValues {
  flow: PolicyFlow
  modes: Record<PolicyAction, ApprovalMode>
  /** 자동 모드인 동작의 일일 상한. 자동이 아니면 값이 있어도 무시한다. */
  dailyLimits: Partial<Record<LimitedAction, number>>
  /** 자동 푸시를 허용할 브랜치 접두어 (예: `feature/`). */
  autoPushPrefixes: string[]
  /** 자동 머지를 허용할 브랜치 이름. 보호 브랜치(master, main 등)를 넣으면 이중 확인이 필요하다. */
  autoMergeBranches: string[]
  /** 보호 브랜치 자동 머지를 켤 때 CEO가 직접 입력한 프로젝트 이름. */
  confirmInput: string | null
  branchPrefix: string
  baseBranch: string | null
  usePr: boolean
  reviewStage: ReviewStage
  dailyOutputGoal: number
  /** 프로젝트 폴더 기준 상대 경로. */
  outputDir: string
  /** T-054 어댑터 id 또는 `manual`. */
  publishAdapter: string
  activeHours: string | null
  memo: string | null
}

export type PolicyWarningCode =
  | 'invalid-value' // 허용 값이 아니라 기본값으로 대체
  | 'duplicate-field'
  | 'immutable-relaxed' // 불변 항목을 완화하는 줄. 무시한다
  | 'auto-not-activated' // 활성화 기록 없이 자동
  | 'auto-activation-stale' // 활성화 뒤 설정이 손으로 바뀜
  | 'auto-limit-missing'
  | 'auto-limit-exceeded'
  | 'auto-target-missing'
  | 'auto-target-invalid'
  | 'auto-requirement-missing' // PR 사용·reviewer-qa 필수·발행 어댑터 요건 미충족
  | 'protected-limit-exceeded'
  | 'protected-merge-unconfirmed' // 보호 브랜치 자동 머지에 이름 확인 없음
  | 'file-unreadable'

export interface PolicyWarning {
  code: PolicyWarningCode
  /** 한국어 필드명 또는 동작. 없을 수 있다. */
  field?: string
  message: string
}

export interface PolicyActivation {
  /** ISO 8601. */
  at: string
  /** `ceo-ui` 또는 승인된 결정 카드 번호(`D-012`). */
  by: string
}

export interface PolicyHistoryEntry {
  at: string
  /** 변경자 표시 (`CEO 직접`, `제안 D-012`). */
  actor: string
  summary: string
}

/** 실제로 적용되는 모드. 유효하지 않은 `auto`는 `every`로 대체돼 있다. 강제는 T-053 게이트가 한다. */
export interface EffectivePolicy {
  flow: PolicyFlow
  modes: Record<PolicyAction, ApprovalMode>
  /** 유효한 자동 동작의 상한. 자동이 아니면 없다. */
  dailyLimits: Partial<Record<LimitedAction, number>>
  autoPushPrefixes: string[]
  autoMergeBranches: string[]
  /** 허용 대상에 보호 브랜치가 포함된 유효한 자동 머지인지. */
  protectedMergeEnabled: boolean
  usePr: boolean
  reviewStage: ReviewStage
}

export interface PolicyState {
  projectId: string
  /** 정책 파일이 있는지. 없으면 보수적 기본값이다. */
  exists: boolean
  /** save에 돌려보낼 낙관적 잠금 값. 파일이 바뀌면 달라진다. */
  revision: string
  values: PolicyValues
  effective: EffectivePolicy
  /** 유효한 자동 활성화 기록. 없으면 null. */
  activation: PolicyActivation | null
  warnings: PolicyWarning[]
  /** 최신이 마지막. */
  history: PolicyHistoryEntry[]
}

export interface PolicyGetRequest {
  projectId: string
}

export interface PolicySaveRequest {
  projectId: string
  /** get이 돌려준 `revision`. 다르면 `conflict`. */
  revision: string
  values: PolicyValues
  /** 자동 모드를 켜거나 바꿀 때 UI의 경고 대화에서 확인했음을 뜻한다. 자동 변경이 아니면 무시한다. */
  confirmAuto?: boolean
}

export type PolicyViolationCode =
  | 'immutable-relaxed' // 불변 규칙을 완화하려는 값 (강제 푸시, 프로젝트 밖 쓰기, 자격 증명 노출 등)
  | 'auto-needs-ceo' // 에이전트 경로는 자동 모드를 켜거나 바꿀 수 없다
  | 'auto-needs-confirm' // confirmAuto 없음
  | 'auto-limit-missing'
  | 'auto-limit-exceeded'
  | 'auto-target-missing'
  | 'auto-target-invalid' // 푸시 대상이 보호 브랜치 등
  | 'auto-requirement-missing'
  | 'protected-merge-unconfirmed' // 확인 입력이 프로젝트 이름과 다름
  | 'protected-limit-exceeded' // 보호 브랜치 머지 상한 1~2 위반
  | 'invalid-value'
  | 'file-too-large'

export interface PolicyViolation {
  code: PolicyViolationCode
  field?: string
  message: string
}

/** 저장 결과. 규칙 위반이면 `saved: false`와 사유 코드 목록을 돌려주고 파일은 바뀌지 않는다. */
export type PolicySaveResult =
  { saved: true; state: PolicyState } | { saved: false; violations: PolicyViolation[] }

/** 프로젝트별 요약 (프로젝트 목록 배지, 방문 요약용). 파일이 없으면 모두 `every`다. */
export interface PolicySummary {
  projectId: string
  exists: boolean
  /** 유효한 자동 모드인 동작. 비어 있지 않으면 배지를 표시한다. */
  autoActions: PolicyAction[]
  protectedMergeEnabled: boolean
  warningCount: number
}
