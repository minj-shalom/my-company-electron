/** 프로젝트 관리(T-037) 계약. 원본은 회사 폴더의 `company/project.md`이고 이 구조는 파생물이다. */
import type { ChangeRecordBase } from './change-record'
import type { OrgModel } from './org'

export const PROJECT_TYPES = ['development', 'content', 'other'] as const
export type ProjectType = (typeof PROJECT_TYPES)[number]

export const PROJECT_STATUSES = ['active', 'archived'] as const
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]

/** 티켓·배정·정책이 참조하는 안정 식별자. 생성 시 이름에서 만들고 이후 바뀌지 않는다. */
export const PROJECT_ID = /^[a-z0-9][a-z0-9-]{0,39}$/
export const MAX_PROJECT_NAME = 50
export const MAX_PROJECT_PATH = 1024
export const MAX_DEV_COMMAND = 200
export const MAX_BRANCH = 100

/**
 * - ready: 활성이고 org.md의 PM 직급 직원이 담당
 * - pm-required: 활성이지만 PM이 없거나 가리키는 직원이 없음·PM 직급이 아님. 티켓 생성은 되고 실행·오토파일럿 대상은 아님
 * - archived: 보관됨
 */
export type ProjectState = 'ready' | 'pm-required' | 'archived'

export interface ProjectLike {
  status: ProjectStatus
  pmId: string | null
}

/** 직급 비교용 정규화. `Pm`, ` PM ` 같은 표기 변형도 PM으로 본다 (employee-service와 같은 규칙). */
export const isPmTitle = (title: string): boolean => title.trim().toLowerCase() === 'pm'

/** org.md에서 이 직원이 PM으로 일할 수 있는지 (직원 파일이 있는 agent이고 직급이 PM). CEO/COO는 직급이 달라 제외된다. */
export function isPmMember(org: OrgModel | null, employeeId: string): boolean {
  return (
    org !== null &&
    org.members.some(
      (m) => m.kind === 'agent' && m.agentId === employeeId && m.fileExists && isPmTitle(m.title)
    )
  )
}

/** 다른 티켓(T-016, T-049, T-053)이 재사용하는 상태 계산. 조직도를 읽지 못했으면(`org === null`) 보수적으로 pm-required다. */
export function projectState(project: ProjectLike, org: OrgModel | null): ProjectState {
  if (project.status === 'archived') return 'archived'
  if (project.pmId === null) return 'pm-required'
  return isPmMember(org, project.pmId) ? 'ready' : 'pm-required'
}

/**
 * 줄 구조를 위조하거나 눈에 보이지 않게 만드는 문자: C0/C1 제어 문자, 줄·문단 구분자(U+2028/2029),
 * 제로폭·방향 제어 문자(U+200B-200F, 202A-202E, 2066-2069), BOM(U+FEFF). 정규식 대신 코드 포인트로 판정한다.
 */
export function hasForbiddenChar(v: string): boolean {
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i)
    if (
      c <= 0x1f ||
      (c >= 0x7f && c <= 0x9f) ||
      c === 0x2028 ||
      c === 0x2029 ||
      (c >= 0x200b && c <= 0x200f) ||
      (c >= 0x202a && c <= 0x202e) ||
      (c >= 0x2066 && c <= 0x2069) ||
      c === 0xfeff
    )
      return true
  }
  return false
}
const MARKDOWN_DELIMITERS = /[#`|<>[\]*\\]/

/** 이름 검증. 통과하면 null, 아니면 사용자에게 보여줄 고정 문구. */
export function checkProjectName(v: unknown): string | null {
  if (typeof v !== 'string') return '프로젝트 이름이 올바르지 않습니다.'
  // 입력 길이를 먼저 제한해 이후 검사가 긴 문자열에서 오래 걸리지 않게 한다.
  if (v.length === 0 || v.length > MAX_PROJECT_NAME * 2)
    return `프로젝트 이름은 1~${MAX_PROJECT_NAME}자여야 합니다.`
  if ([...v].length > MAX_PROJECT_NAME) return `프로젝트 이름은 1~${MAX_PROJECT_NAME}자여야 합니다.`
  if (v !== v.trim()) return '프로젝트 이름 앞뒤에 공백을 둘 수 없습니다.'
  if (hasForbiddenChar(v)) return '프로젝트 이름에 제어 문자를 쓸 수 없습니다.'
  if (MARKDOWN_DELIMITERS.test(v))
    return '프로젝트 이름에 # ` | < > [ ] * \\ 문자를 쓸 수 없습니다.'
  return null
}

export interface ProjectPmInfo {
  id: string
  /** 직원 파일 frontmatter의 name. 읽지 못하면 id. */
  name: string
}

/** 레포 조회 결과. 읽기 전용 `git` 조회만 했다. */
export type ProjectGit =
  | { status: 'ok'; branch: string | null; dirty: boolean }
  | { status: 'not-repo' } // 폴더에 `.git`이 없음 (content/other는 정상)
  | { status: 'missing' } // 폴더가 없거나 더는 안전한 경로가 아님
  | { status: 'unavailable'; branch?: string | null } // git 실행 실패·시간 초과 (`.git/HEAD`로 읽은 브랜치만 알 수 있으면 branch)

export interface ProjectInfo {
  id: string
  name: string
  type: ProjectType
  /** 표시용 절대 경로. renderer가 파일 접근에 쓰지 않는다. */
  path: string
  devCommand: string | null
  defaultBranch: string | null
  status: ProjectStatus
  /** `project.md`의 `PM:` 값. 가리키는 직원이 없어도 그대로 남는다. */
  pmId: string | null
  /** 현재 org.md에서 유효한 PM이면 표시 정보, 아니면 null. */
  pm: ProjectPmInfo | null
  state: ProjectState
  git: ProjectGit
}

/** 읽지 못한 프로젝트 블록. 파일 원문은 담지 않고 위치와 고정 분류만 알린다. */
export interface ProjectIssue {
  /** project.md 안의 1부터 시작하는 줄 번호. */
  line: number
  reason: 'invalid-block'
}

export interface ProjectList {
  items: ProjectInfo[]
  unreadable: ProjectIssue[]
  /** `blocks`: 새 형식, `legacy`: 기존 단일 형식을 해석한 것(저장 전까지 파일은 그대로), `empty`: 프로젝트 없음. */
  format: 'blocks' | 'legacy' | 'empty'
}

export type ProjectChangeAction =
  'add' | 'rename' | 'archive' | 'restore' | 'set-type' | 'set-pm' | 'clear-pm'

/** 프로젝트 변경 감사 기록. renderer 호출은 항상 `ceo-ui`다. 저장 위치는 T-046/T-052가 정한다. */
export interface ProjectChangeRecord extends ChangeRecordBase {
  action: ProjectChangeAction
  projectId: string
  /** PM 변경 기록 (set-pm, clear-pm, add with pm). */
  pmBefore: string | null
  pmAfter: string | null
  changedFields: string[]
}

export interface ProjectChangeResult {
  record: ProjectChangeRecord
  project: ProjectInfo
}

/** `project:select-folder` 결과. 취소하면 null. `project:add`는 여기서 돌려받은 경로만 받는다. */
export type ProjectSelectFolderResult = string | null

export interface ProjectAddRequest {
  /** `project:select-folder`가 돌려준 경로. */
  path: string
  name: string
  /** 생략하면 development. */
  type?: ProjectType
  /** development만. */
  devCommand?: string
  /** development만. */
  defaultBranch?: string
  /** 직원 id. org.md에 있는 PM 직급 직원이어야 한다. */
  pm?: string
}

export interface ProjectRenameRequest {
  id: string
  name: string
}

export interface ProjectIdRequest {
  id: string
}

export interface ProjectSetTypeRequest {
  id: string
  type: ProjectType
}

export interface ProjectSetPmRequest {
  id: string
  pm: string
}
