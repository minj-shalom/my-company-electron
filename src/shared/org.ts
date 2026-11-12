/** 조직도(`company/org.md`) 파싱 결과 타입. 원본은 마크다운이고 이 구조는 파생물이다. */

export type OrgMemberKind =
  | 'human' // `(사용자)` 같은 사람. 에이전트 파일이 없다.
  | 'main-session' // `CLAUDE.md`. 메인 세션(COO)이며 `.claude/agents/`에 파일이 없다.
  | 'agent' // `.claude/agents/<id>.md`
  | 'invalid' // 직원 파일 칸을 해석할 수 없음 (오류로 보고된다)

export type OrgIssueCode =
  | 'missing-org' // org.md 없음
  | 'unreadable' // org.md를 읽을 수 없음 (링크, 디렉터리 등)
  | 'file-too-large' // 크기 제한 초과
  | 'no-table' // `직원 목록` 표가 없거나 비어 있음
  | 'missing-columns' // 필수 열(직급, 직원 파일)이 머리글에 없음
  | 'malformed-row' // 열 개수 불일치, 빈 직급, 허용되지 않는 문자 등
  | 'too-many-rows' // 행 수 제한 초과 (초과분은 무시)
  | 'invalid-file-ref' // 직원 파일 칸이 허용 형식이 아님 (경로 탈출 시도 포함)
  | 'missing-agent-file' // `.claude/agents/<id>.md`가 없음
  | 'duplicate-employee' // 같은 직급 또는 같은 직원 파일이 두 번 나옴
  | 'multiple-departments' // 한 직원이 여러 부서에 속함
  | 'multiple-reports-to' // 보고 대상이 여러 명
  | 'unknown-reports-to' // 보고 대상이 표에 없음
  | 'cycle' // 보고 라인 순환

export interface OrgIssue {
  code: OrgIssueCode
  message: string
  /** org.md 안의 1부터 시작하는 줄 번호. 알 수 없으면 생략. */
  line?: number
}

export interface OrgMember {
  /** 표 안에서 유일한 직급 (예: CTO). 보고 라인의 키로 쓴다. */
  title: string
  kind: OrgMemberKind
  /** `kind === 'agent'`일 때의 에이전트 id. */
  agentId: string | null
  /** `kind === 'agent'`이고 `.claude/agents/<id>.md`가 있으면 true. 다른 종류는 파일이 필요 없으므로 true. */
  fileExists: boolean
  department: string | null
  /** 보고 대상 직급. 최상위면 null. 순환이 끊긴 경우도 null. */
  reportsTo: string | null
  role: string
}

export interface OrgDepartment {
  name: string
  /** 소속 직급 (표 순서). */
  members: string[]
}

export interface OrgTreeNode {
  member: OrgMember
  children: OrgTreeNode[]
}

/** `조직도` 코드 블록의 한 줄. 표시용 참고 정보이며 보고 라인의 원본은 표다. */
export interface OrgChartLine {
  label: string
  /** 같은 블록 안에서 바로 위 들여쓰기 수준의 줄. 없으면 null. */
  parent: string | null
  /** 라벨 뒤의 부가 설명 (예: 부서, 소속 직원). */
  detail: string
}

export interface OrgModel {
  members: OrgMember[]
  departments: OrgDepartment[]
  /** 보고 라인 트리. 보통 루트는 CEO 하나다. */
  tree: OrgTreeNode[]
  chart: OrgChartLine[]
  issues: OrgIssue[]
}

export interface OrgMemberInput {
  title: string
  /** `.claude/agents/<agentId>.md`가 이미 있어야 한다. */
  agentId: string
  department: string
  /** 보고 대상 직급. 표에 있는 직급이어야 한다. */
  reportsTo: string
  role: string
}

export interface OrgDepartmentInput {
  name: string
  /** 부서는 소속 직원이 있어야 표에 나타난다. 부서장이 될 첫 직원. */
  lead: Omit<OrgMemberInput, 'department'>
}
