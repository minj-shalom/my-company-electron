/** 직원 채용·수정·이동·퇴사(T-035) 계약. 원본은 `.claude/agents/<id>.md`와 `company/org.md`. */

/** 호출자 구분. renderer가 보내는 IPC는 항상 `ceo-ui`로 처리된다. `approved-proposal`은 main 코드(T-046)만 쓴다. */
export const EMPLOYEE_ACTORS = ['ceo-ui', 'approved-proposal'] as const
export type EmployeeActor = (typeof EMPLOYEE_ACTORS)[number]

/** 직원 `model` 허용 목록. */
export const EMPLOYEE_MODELS = ['opus', 'sonnet', 'haiku', 'inherit'] as const
export type EmployeeModel = (typeof EMPLOYEE_MODELS)[number]

export const MAX_EMPLOYEE_DESCRIPTION = 1000
export const MAX_EMPLOYEE_TOOLS = 30
/** 직원 프롬프트 본문 상한 (UTF-8 바이트). 직원 파일 전체가 1MB 읽기 한도 안에 들어가도록 약간 작게 잡는다. */
export const MAX_EMPLOYEE_BODY_BYTES = 1_000_000

/** `employee:list-templates` 항목. 앱 번들 상수이며 사용자 파일을 읽지 않는다. */
export interface EmployeeTemplateInfo {
  id: string
  /** org.md 직급 기본값. */
  title: string
  /** org.md 부서 기본값 (추천). */
  department: string
  /** org.md 역할 열 기본값. */
  role: string
  description: string
  model: EmployeeModel
  tools: string[]
  body: string
}

export interface EmployeeCreateRequest {
  templateId: string
  /** 직원 id = 파일명. `^[a-z0-9][a-z0-9-]{0,49}$`. */
  id: string
  department: string
  /** 보고 대상 직급 (org.md 표에 있는 직급). */
  reportsTo: string
  /** 생략하면 템플릿 기본 직급. */
  title?: string
  /** 생략하면 템플릿 기본 역할. */
  role?: string
  /** 민감 변경이면 필수: 승인된(done) 결정 카드 번호 (예: D-021). */
  approval?: string
}

export interface EmployeeUpdateRequest {
  id: string
  description?: string
  model?: EmployeeModel
  /** 빈 배열이면 `tools` 키를 지운다 (모든 도구 상속 = 확대로 본다). */
  tools?: string[]
  /** 프롬프트 본문. 줄바꿈은 `\n`으로 정규화된다. */
  body?: string
  approval?: string
}

export interface EmployeeMoveRequest {
  id: string
  department?: string
  reportsTo?: string
  /** 직급 변경. 이 직급을 보고 대상으로 쓰는 직원이 있으면 거부한다. */
  title?: string
  role?: string
  approval?: string
}

export interface EmployeeRetireRequest {
  id: string
  /** 퇴사는 항상 민감 변경이므로 필수. */
  approval?: string
}

export type EmployeeChangeAction = 'create' | 'update' | 'move' | 'retire'

export type SensitiveReason =
  | 'protected-role' // COO·CTO·CFO·hr 파일/행 변경
  | 'tools-expansion' // Bash 추가 또는 쓰기 도구 범위 확대
  | 'retire' // 직원 삭제(퇴사)

/** T-046 감사 줄(`company/audit/hr.md`)용 변경 기록. 프롬프트 본문 등 내용은 담지 않는다. */
export interface ChangeRecord {
  action: EmployeeChangeAction
  employeeId: string
  actor: EmployeeActor
  /** 승인 카드 번호. 없으면 null. */
  approval: string | null
  sensitive: boolean
  sensitiveReasons: SensitiveReason[]
  /** 바뀐 필드 이름 (`description`, `model`, `tools`, `body`, `title`, `department`, `reportsTo`, `role`, `file`, `row`). */
  changedFields: string[]
  /** 회사 폴더 기준 상대 경로. */
  files: string[]
  /** ISO 시각. */
  at: string
}

/** `pm-required`: PM 직급이 바뀌어 그 직원이 PM인 프로젝트가 "PM 필요"가 될 수 있다. */
export interface EmployeeWarning {
  code: 'pm-required'
  message: string
}

export interface EmployeeChangeResult {
  record: ChangeRecord
  warnings: EmployeeWarning[]
}

/** 직원의 프로젝트 배정. T-045 전에는 항상 빈 목록. */
export interface EmployeeAssignment {
  projectId: string
  role: 'member' | 'pm'
}
