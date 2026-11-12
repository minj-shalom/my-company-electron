import type { WindowApi } from '../../../shared/api'
import type {
  OrgAgentDetail,
  OrgIssue,
  OrgIssueCode,
  OrgMember,
  OrgMemberKind,
  OrgSnapshot
} from '../../../shared/org'

export type OrgStatus =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'empty'; issues: OrgIssueView[] }
  | { kind: 'ready'; snapshot: OrgSnapshot; issues: OrgIssueView[] }

export interface OrgIssueView {
  text: string
  /** 조직도를 아예 못 그리게 하는 문제인지. */
  blocking: boolean
}

const GENERIC_ERROR = '조직도를 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.'
const NOT_IMPLEMENTED = '이 버전의 앱은 아직 조직도 조회를 지원하지 않아요.'

/** 이슈 코드별 사용자용 문장. main이 준 `message`는 그대로 쓰지 않는다 (내부 표현이 섞일 수 있다). */
const ISSUE_TEXT: Record<OrgIssueCode, { text: string; blocking: boolean }> = {
  'missing-org': {
    text: '조직도 문서(company/org.md)가 없어요. 회사 폴더에 org.md를 만들어 주세요.',
    blocking: true
  },
  unreadable: {
    text: '조직도 문서나 직원 폴더를 읽을 수 없어요. 파일 권한과 종류를 확인해 주세요.',
    blocking: true
  },
  'file-too-large': {
    text: '조직도 문서가 너무 커서 읽지 않았어요. 내용을 줄여 주세요.',
    blocking: true
  },
  'no-table': {
    text: '조직도 문서에 "직원 목록" 표가 없거나 비어 있어요.',
    blocking: true
  },
  'missing-columns': {
    text: '"직원 목록" 표에 꼭 필요한 열(직급, 직원 파일)이 없어요.',
    blocking: true
  },
  'malformed-row': {
    text: '표의 일부 줄을 해석할 수 없어요. 열 개수와 직급 칸을 확인해 주세요.',
    blocking: false
  },
  'too-many-rows': { text: '직원이 너무 많아 일부 줄은 표시하지 않았어요.', blocking: false },
  'invalid-file-ref': {
    text: '직원 파일 칸의 값이 허용되는 형식이 아니에요.',
    blocking: false
  },
  'missing-agent-file': {
    text: '표에는 있지만 직원 파일(.claude/agents)이 없는 직원이 있어요.',
    blocking: false
  },
  'duplicate-employee': { text: '같은 직급이나 직원 파일이 두 번 나와요.', blocking: false },
  'multiple-departments': { text: '한 직원이 여러 부서에 적혀 있어요.', blocking: false },
  'multiple-reports-to': { text: '보고 대상이 여러 명으로 적힌 직원이 있어요.', blocking: false },
  'unknown-reports-to': { text: '보고 대상이 표에 없는 직급이에요.', blocking: false },
  cycle: { text: '보고 라인이 순환해요. 누군가의 보고 대상을 바꿔 주세요.', blocking: false }
}

const UNKNOWN_ISSUE = { text: '조직도 문서에서 알 수 없는 문제가 발견됐어요.', blocking: false }

export function describeIssue(issue: OrgIssue): OrgIssueView {
  const base = Object.hasOwn(ISSUE_TEXT, issue.code) ? ISSUE_TEXT[issue.code] : UNKNOWN_ISSUE
  const line =
    Number.isInteger(issue.line) && (issue.line as number) > 0 ? ` (${issue.line}번째 줄)` : ''
  return { text: base.text + line, blocking: base.blocking }
}

/** 조회 결과를 화면 상태로 바꾼다. 멤버가 없으면 이슈가 있어도 `empty`로 보여 주되 원인을 함께 싣는다. */
export function toOrgStatus(snapshot: OrgSnapshot): OrgStatus {
  const issues = snapshot.org.issues.map(describeIssue)
  if (snapshot.org.members.length === 0) return { kind: 'empty', issues }
  return { kind: 'ready', snapshot, issues }
}

export async function loadOrgStatus(api: Pick<WindowApi, 'getOrg'>): Promise<OrgStatus> {
  try {
    const r = await api.getOrg()
    if (r.ok) return toOrgStatus(r.value)
    return {
      kind: 'error',
      message: r.code === 'not-implemented' ? NOT_IMPLEMENTED : GENERIC_ERROR
    }
  } catch {
    return { kind: 'error', message: GENERIC_ERROR }
  }
}

export interface DepartmentGroup {
  name: string
  /** 부서 색 토큰 이름 (`--dept-<tone>`). */
  tone: DeptTone
  members: OrgMember[]
}

export type DeptTone = 'exec' | 'rnd' | 'fin' | 'plan'
const TONES: readonly DeptTone[] = ['exec', 'rnd', 'fin', 'plan']

/** 부서 순서대로 토큰을 돌려 쓴다. 이름과 함께 표시되므로 색만으로 구분하지 않는다. */
export function deptTone(index: number): DeptTone {
  return TONES[((index % TONES.length) + TONES.length) % TONES.length]
}

export const NO_DEPARTMENT = '소속 없음'

/** 부서별 그룹 (부서 순서 유지). 부서가 없는 직원은 마지막 `소속 없음` 그룹에 모은다. */
export function groupByDepartment(snapshot: OrgSnapshot): DepartmentGroup[] {
  const byTitle = new Map(snapshot.org.members.map((m) => [m.title, m]))
  const placed = new Set<string>()
  const groups: DepartmentGroup[] = snapshot.org.departments.map((d, i) => {
    const members = d.members.flatMap((t) => {
      const m = byTitle.get(t)
      if (!m || placed.has(t)) return []
      placed.add(t)
      return [m]
    })
    return { name: d.name, tone: deptTone(i), members }
  })
  const rest = snapshot.org.members.filter((m) => !placed.has(m.title))
  if (rest.length > 0)
    groups.push({ name: NO_DEPARTMENT, tone: deptTone(groups.length), members: rest })
  return groups.filter((g) => g.members.length > 0)
}

/** 직급 -> 부서 색. 부서가 없으면 null. */
export function toneByTitle(groups: readonly DepartmentGroup[]): Map<string, DeptTone> {
  const map = new Map<string, DeptTone>()
  for (const g of groups) {
    if (g.name === NO_DEPARTMENT) continue
    for (const m of g.members) map.set(m.title, g.tone)
  }
  return map
}

export const KIND_LABELS: Record<OrgMemberKind, string> = {
  human: '사람',
  'main-session': '메인 세션',
  agent: 'AI 직원',
  invalid: '확인 필요'
}

export const EMPTY_VALUE = '정보 없음'

export interface MemberDetailView {
  title: string
  kindLabel: string
  department: string
  reportsTo: string
  role: string
  /** 직원 파일 상태 안내. 문제가 없으면 null. */
  fileNote: string | null
  name: string | null
  description: string
  model: string
  tools: string[]
}

/** 상세 패널용 값. 데이터가 없으면 빈 값 문구로 채워 화면이 비지 않게 한다. */
export function memberDetail(
  member: OrgMember,
  agents: readonly OrgAgentDetail[]
): MemberDetailView {
  const agent = member.agentId ? agents.find((a) => a.id === member.agentId) : undefined
  let fileNote: string | null = null
  if (member.kind === 'invalid') fileNote = '직원 파일 칸을 해석할 수 없어요.'
  else if (member.kind === 'agent' && !member.fileExists)
    fileNote = '직원 파일(.claude/agents)이 아직 없어요.'
  return {
    title: member.title,
    kindLabel: KIND_LABELS[member.kind],
    department: member.department ?? EMPTY_VALUE,
    reportsTo: member.reportsTo ?? '없음 (최상위)',
    role: member.role.trim() || EMPTY_VALUE,
    fileNote,
    name: agent?.name ?? null,
    description: agent?.description.trim() || EMPTY_VALUE,
    model: agent?.model?.trim() || EMPTY_VALUE,
    tools: agent ? agent.tools.filter((t) => t.trim() !== '') : []
  }
}

/** 위/아래 화살표로 목록 안에서 이동할 다음 인덱스. 해당 없는 키는 null. */
export function nextListIndex(key: string, current: number, count: number): number | null {
  if (count <= 0) return null
  switch (key) {
    case 'ArrowDown':
      return Math.min(current + 1, count - 1)
    case 'ArrowUp':
      return Math.max(current - 1, 0)
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return null
  }
}
