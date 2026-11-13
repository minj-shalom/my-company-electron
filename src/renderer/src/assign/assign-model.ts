import type { WindowApi } from '../../../shared/api'
import type { OrgAgentDetail, OrgAgentProject, OrgSnapshot } from '../../../shared/org'
import type { AssignmentIssue, ProjectInfo } from '../../../shared/project'
import type { DomainErrorCode } from '../../../shared/result'

export const ROLE_LABEL = { pm: 'PM', member: '팀원' } as const
export const UNASSIGNED_LABEL = '배정 대기'
export const MAX_BADGES = 3

export interface NormalizedProject {
  id: string
  name: string
  role: 'pm' | 'member'
  active: boolean
}

/** 필드가 없는 응답은 미배정이다. role이 없으면 팀원, active가 없으면 활성. PM 먼저, 이름순. */
export function agentProjects(
  agent: Pick<OrgAgentDetail, 'projects'> | undefined
): NormalizedProject[] {
  const list = agent?.projects ?? []
  return list
    .map((p: OrgAgentProject) => ({
      id: p.id,
      name: p.name,
      role: p.role === 'pm' ? ('pm' as const) : ('member' as const),
      active: p.active !== false
    }))
    .sort((a, b) =>
      a.role !== b.role ? (a.role === 'pm' ? -1 : 1) : a.name.localeCompare(b.name, 'ko')
    )
}

export const activeProjects = (list: readonly NormalizedProject[]): NormalizedProject[] =>
  list.filter((p) => p.active)

/** 활성 배정이 하나도 없으면 미배정 (보관된 프로젝트의 배정만 있어도 일할 곳이 없다). */
export const isUnassigned = (list: readonly NormalizedProject[]): boolean =>
  activeProjects(list).length === 0

/** 프로젝트 하나의 한 줄 설명. 색이 아니라 글자로 역할과 비활성을 알린다. */
export function projectText(p: NormalizedProject): string {
  const role = p.role === 'pm' ? ' (PM)' : ''
  const archived = p.active ? '' : ' (보관됨)'
  return `${p.name}${role}${archived}`
}

/** 키보드용 직원 목록에 붙이는 텍스트. 없으면 "배정 대기". */
export function projectsSummary(list: readonly NormalizedProject[]): string {
  if (list.length === 0) return UNASSIGNED_LABEL
  return list.map(projectText).join(', ')
}

export interface BadgeView {
  items: { id: string; initial: string; name: string; role: 'pm' | 'member'; colorIndex: number }[]
  extra: number
  pm: boolean
}

/** 프로젝트 id 순서대로 색 번호를 준다. 같은 프로젝트는 지도와 목록에서 항상 같은 번호다. */
export function projectColorIndexes(ids: readonly string[]): Map<string, number> {
  return new Map([...new Set(ids)].sort().map((id, i) => [id, i % PROJECT_COLORS]))
}
export const PROJECT_COLORS = 5

/** 아바타 배지. 활성 배정만, 최대 3개와 "+N". 이니셜은 첫 글자(없으면 ?)다. */
export function badgeView(
  list: readonly NormalizedProject[],
  colors: ReadonlyMap<string, number>
): BadgeView {
  const act = activeProjects(list)
  return {
    items: act.slice(0, MAX_BADGES).map((p) => ({
      id: p.id,
      initial: [...p.name.trim()][0] ?? '?',
      name: p.name,
      role: p.role,
      colorIndex: colors.get(p.id) ?? 0
    })),
    extra: Math.max(0, act.length - MAX_BADGES),
    pm: act.some((p) => p.role === 'pm')
  }
}

/** 직급(title) -> 담당 프로젝트. 직원 파일이 없는 항목은 빈 목록. */
export function projectsByTitle(snapshot: OrgSnapshot): Map<string, NormalizedProject[]> {
  const out = new Map<string, NormalizedProject[]>()
  for (const m of snapshot.org.members) {
    const agent = m.agentId ? snapshot.agents.find((a) => a.id === m.agentId) : undefined
    out.set(m.title, agentProjects(agent))
  }
  return out
}

export interface ProjectFilterOption {
  id: string
  name: string
  count: number
}

/** 활성 배정이 있는 프로젝트 목록(이름순)과 배정 인원. 지도 필터 선택지다. */
export function filterOptions(
  byTitle: ReadonlyMap<string, NormalizedProject[]>
): ProjectFilterOption[] {
  const map = new Map<string, ProjectFilterOption>()
  for (const list of byTitle.values())
    for (const p of activeProjects(list)) {
      const cur = map.get(p.id)
      if (cur) cur.count += 1
      else map.set(p.id, { id: p.id, name: p.name, count: 1 })
    }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'ko'))
}

/** 필터로 강조할 직급 집합. 필터가 없으면 null(모두 강조). */
export function highlightTitles(
  byTitle: ReadonlyMap<string, NormalizedProject[]>,
  projectId: string | null
): ReadonlySet<string> | null {
  if (projectId === null) return null
  const out = new Set<string>()
  for (const [title, list] of byTitle)
    if (activeProjects(list).some((p) => p.id === projectId)) out.add(title)
  return out
}

export interface PersonRow {
  id: string
  label: string
  role: 'pm' | 'member'
  known: boolean
}

/** 프로젝트에서 함께 일하는 직원. PM 먼저, 조직도에 없는 id는 id로 표시한다. */
export function projectPeople(project: ProjectInfo, snapshot: OrgSnapshot | null): PersonRow[] {
  const name = (id: string): { label: string; known: boolean } => {
    const m = snapshot?.org.members.find((x) => x.agentId === id)
    const a = snapshot?.agents.find((x) => x.id === id)
    if (!m) return { label: id, known: false }
    return {
      label: a?.name && a.name !== m.title ? `${m.title} (${a.name})` : m.title,
      known: true
    }
  }
  const rows: PersonRow[] = []
  if (project.pmId !== null) rows.push({ id: project.pmId, role: 'pm', ...name(project.pmId) })
  for (const id of project.memberIds ?? [])
    if (id !== project.pmId) rows.push({ id, role: 'member', ...name(id) })
  return rows
}

export interface Candidate {
  id: string
  label: string
}

/** 직접 배정 후보: 직원 파일이 있는 AI 직원 중 지정한 프로젝트에 아직 없는 직원. */
export function projectCandidates(project: ProjectInfo, snapshot: OrgSnapshot): Candidate[] {
  const taken = new Set([...(project.memberIds ?? []), ...(project.pmId ? [project.pmId] : [])])
  return snapshot.org.members.flatMap((m) =>
    m.kind === 'agent' && m.agentId && m.fileExists && !taken.has(m.agentId)
      ? [{ id: m.agentId, label: m.title }]
      : []
  )
}

/** 직원에게 배정할 수 있는 프로젝트: 활성이고 아직 배정/PM이 아닌 것. */
export function employeeCandidates(
  projects: readonly ProjectInfo[],
  employeeId: string,
  current: readonly NormalizedProject[]
): ProjectInfo[] {
  const have = new Set(current.map((p) => p.id))
  return projects.filter(
    (p) =>
      p.status === 'active' &&
      !have.has(p.id) &&
      p.pmId !== employeeId &&
      !(p.memberIds ?? []).includes(employeeId)
  )
}

/** 프로젝트가 없는 직원(회사 공통 업무만 맡는다). CEO·COO는 직원 파일이 없어 제외된다. */
export function unassignedEmployees(snapshot: OrgSnapshot): { id: string; title: string }[] {
  return snapshot.org.members.flatMap((m) => {
    if (m.kind !== 'agent' || !m.agentId) return []
    const agent = snapshot.agents.find((a) => a.id === m.agentId)
    return isUnassigned(agentProjects(agent)) ? [{ id: m.agentId, title: m.title }] : []
  })
}

export function assignErrorText(code: DomainErrorCode | 'unknown', verb: '배정' | '해제'): string {
  switch (code) {
    case 'forbidden':
      return 'CEO와 COO는 프로젝트 배정 대상이 아니에요.'
    case 'not-found':
      return '직원이나 프로젝트를 찾지 못했어요. 목록을 다시 불러와 주세요.'
    case 'conflict':
      return verb === '배정'
        ? '배정할 수 없어요. 보관된 프로젝트이거나 이미 담당 PM이에요. 다른 곳에서 먼저 바뀌었다면 다시 불러와 주세요.'
        : '해제할 수 없어요. 담당 PM은 프로젝트 화면에서 바꿔 주세요. 다른 곳에서 먼저 바뀌었다면 다시 불러와 주세요.'
    case 'invalid-request':
      return '요청 내용이 올바르지 않아요.'
    default:
      return `${verb}하지 못했어요. 바뀐 것은 없어요. 잠시 뒤 다시 시도해 주세요.`
  }
}

export const isStaleAssign = (code: string): boolean => code === 'conflict' || code === 'not-found'

export type AssignOutcome =
  { ok: true; message: string } | { ok: false; text: string; stale: boolean }

/** 배정/해제 한 번. 예외도 실패 문구로 바꿔 화면이 끊기지 않게 한다. */
export async function runAssign(
  api: Pick<WindowApi, 'assignProjectEmployee' | 'unassignProjectEmployee'>,
  kind: 'assign' | 'unassign',
  req: { id: string; employeeId: string },
  names: { project: string; employee: string }
): Promise<AssignOutcome> {
  const verb = kind === 'assign' ? '배정' : '해제'
  try {
    const r = await (kind === 'assign'
      ? api.assignProjectEmployee(req)
      : api.unassignProjectEmployee(req))
    if (r.ok)
      return {
        ok: true,
        message:
          kind === 'assign'
            ? `${names.employee}을(를) "${names.project}"에 배정했어요.`
            : `${names.employee}의 "${names.project}" 배정을 해제했어요.`
      }
    return { ok: false, text: assignErrorText(r.code, verb), stale: isStaleAssign(r.code) }
  } catch {
    return { ok: false, text: assignErrorText('unknown', verb), stale: false }
  }
}

const ISSUE_TEXT: Record<AssignmentIssue['code'], string> = {
  'unknown-employee': '조직도에 없는 직원',
  'protected-employee': 'CEO·COO(배정 대상이 아님)'
}

/** 배정 경고 문장. 직원·프로젝트 id만 쓰고 파일 내용은 쓰지 않는다. */
export function describeAssignmentIssue(i: AssignmentIssue): string {
  const kind = Object.hasOwn(ISSUE_TEXT, i.code) ? ISSUE_TEXT[i.code] : '확인이 필요한 직원'
  const line = i.role === 'pm' ? 'PM 줄' : '직원 줄'
  return `프로젝트 ${i.projectId}의 ${line}에 ${kind}(${i.employeeId})이 있어요.`
}

/** 티켓 폼·보드용: 프로젝트가 있는데 담당이 그 프로젝트의 PM·팀원이 아니면 true. */
export function isAssigneeUnassigned(
  project: Pick<ProjectInfo, 'pmId' | 'memberIds' | 'status'> | undefined,
  assignee: string | null
): boolean {
  if (!project || project.status === 'archived' || assignee === null || assignee === '')
    return false
  return project.pmId !== assignee && !(project.memberIds ?? []).includes(assignee)
}
