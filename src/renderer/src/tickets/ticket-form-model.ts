import type { WindowApi } from '../../../shared/api'
import type { Employee } from '../../../shared/employee'
import type { ProjectInfo } from '../../../shared/project'
import type { DomainErrorCode } from '../../../shared/result'
import {
  defaultTicketAssignee,
  MAX_TICKET_CRITERIA,
  MAX_TICKET_CRITERION,
  MAX_TICKET_GOAL,
  MAX_TICKET_TITLE,
  type Ticket
} from '../../../shared/ticket'

/** 폼이 편집하는 값. 담당·프로젝트의 빈 문자열은 "담당 없음"/"회사 공통"이다 (select value 용). */
export interface TicketDraft {
  title: string
  goal: string
  criteria: string[]
  assignee: string
  projectId: string
}

export const EMPTY_DRAFT: TicketDraft = {
  title: '',
  goal: '',
  criteria: [''],
  assignee: '',
  projectId: ''
}

const PROJECT_ID = /^[a-z0-9][a-z0-9-]{0,63}$/

function section(lines: string[], name: string): string[] {
  const start = lines.findIndex((l) => l.trim() === `## ${name}`)
  if (start < 0) return []
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((l) => /^##\s/.test(l))
  return end < 0 ? rest : rest.slice(0, end)
}

/** 저장된 본문에서 폼 값을 뽑는다. 화면 표시용일 뿐이며 저장 때는 main이 다시 검증한다. */
export function parseTicketBody(body: string): {
  goal: string
  criteria: string[]
  projectId: string | null
} {
  const lines = body.split(/\r?\n/)
  const goal = section(lines, '목표').join('\n').trim()
  const criteria = section(lines, '완료 조건')
    .map((l) => /^\s*[-*]\s+(?:\[[ xX]\]\s*)?(.*\S)\s*$/.exec(l)?.[1] ?? null)
    .filter((c): c is string => c !== null)
  const raw = /^\s*-\s*\*\*프로젝트:\*\*\s*`?([^`\s]+)`?\s*$/m.exec(body)?.[1] ?? null
  return { goal, criteria, projectId: raw !== null && PROJECT_ID.test(raw) ? raw : null }
}

export function draftFromTicket(t: Ticket): TicketDraft {
  const p = parseTicketBody(t.body)
  return {
    title: t.title,
    goal: p.goal,
    criteria: p.criteria.length > 0 ? p.criteria : [''],
    assignee: t.assignee ?? '',
    projectId: p.projectId ?? ''
  }
}

export const charCount = (s: string): number => [...s].length

export interface DraftErrors {
  title?: string
  goal?: string
  criteria?: string
  /** 항목별 오류 (인덱스는 폼의 행 번호). */
  rows: Record<number, string>
}

/** 클라이언트 검증은 편의일 뿐이다. 최종 검증은 main이 한다. */
export function validateDraft(d: TicketDraft): DraftErrors {
  const errors: DraftErrors = { rows: {} }
  const title = d.title.trim()
  if (title === '') errors.title = '제목을 입력해 주세요.'
  else if (charCount(title) > MAX_TICKET_TITLE)
    errors.title = `제목은 ${MAX_TICKET_TITLE}자까지 쓸 수 있어요.`
  if (charCount(d.goal.trim()) > MAX_TICKET_GOAL)
    errors.goal = `목표는 ${MAX_TICKET_GOAL}자까지 쓸 수 있어요.`
  else if (d.goal.split(/\r?\n/).some((l) => /^\s*(#|```|~~~)/.test(l)))
    errors.goal = '목표에는 #으로 시작하는 줄이나 코드 블록을 쓸 수 없어요.'
  const filled = d.criteria.map((c) => c.trim())
  if (filled.every((c) => c === '')) errors.criteria = '완료 조건을 1개 이상 입력해 주세요.'
  else if (filled.filter((c) => c !== '').length > MAX_TICKET_CRITERIA)
    errors.criteria = `완료 조건은 ${MAX_TICKET_CRITERIA}개까지 쓸 수 있어요.`
  filled.forEach((c, i) => {
    if (charCount(c) > MAX_TICKET_CRITERION)
      errors.rows[i] = `항목은 ${MAX_TICKET_CRITERION}자까지 쓸 수 있어요.`
  })
  return errors
}

export const hasErrors = (e: DraftErrors): boolean =>
  e.title !== undefined ||
  e.goal !== undefined ||
  e.criteria !== undefined ||
  Object.keys(e.rows).length > 0

/** 빈 항목은 버리고 앞뒤 공백을 정리해 요청 값으로 바꾼다. */
export function toRequestFields(d: TicketDraft): {
  title: string
  goal: string
  criteria: string[]
  assignee: string | null
  projectId: string | null
} {
  return {
    title: d.title.trim(),
    goal: d.goal.trim(),
    criteria: d.criteria.map((c) => c.trim()).filter((c) => c !== ''),
    assignee: d.assignee === '' ? null : d.assignee,
    projectId: d.projectId === '' ? null : d.projectId
  }
}

/** 프로젝트를 바꿀 때 담당 칸의 기본값. 사용자가 담당을 직접 고르지 않았을 때만 쓴다. */
export function assigneeFor(projects: readonly ProjectInfo[], projectId: string): string {
  const p = projects.find((x) => x.id === projectId) ?? null
  return defaultTicketAssignee(p) ?? ''
}

export interface FormOptions {
  projects: ProjectInfo[]
  employees: Pick<Employee, 'id' | 'name' | 'title'>[]
  /** 목록을 못 읽은 항목. 폼은 계속 쓸 수 있고 해당 선택지만 제한된다. */
  projectsFailed: boolean
  employeesFailed: boolean
}

export async function loadFormOptions(
  api: Pick<WindowApi, 'listProjects' | 'listEmployees'>
): Promise<FormOptions> {
  const [projects, employees] = await Promise.all([
    api.listProjects().catch(() => null),
    api.listEmployees().catch(() => null)
  ])
  const pOk = projects !== null && projects.ok
  const eOk = employees !== null && employees.ok
  return {
    projects: pOk ? projects.value.items : [],
    employees: eOk ? employees.value.employees : [],
    projectsFailed: !pOk,
    employeesFailed: !eOk
  }
}

export interface ProjectChoice {
  value: string
  label: string
}

/** 보관되지 않은 프로젝트와 "회사 공통". 이미 보관된/모르는 프로젝트에 속한 티켓은 현재 값을 유지할 수 있게 덧붙인다. */
export function projectChoices(options: FormOptions, current: string): ProjectChoice[] {
  const out: ProjectChoice[] = [{ value: '', label: '회사 공통' }]
  for (const p of options.projects)
    if (p.status !== 'archived') out.push({ value: p.id, label: p.name })
  if (current !== '' && !out.some((c) => c.value === current)) {
    const old = options.projects.find((p) => p.id === current)
    out.push({ value: current, label: old ? `${old.name} (보관됨)` : '알 수 없는 프로젝트' })
  }
  return out
}

export interface AssigneeChoice {
  value: string
  label: string
}

/** 담당 없음 + 현재 직원. 조직에 없는 현재 담당은 값을 잃지 않게 덧붙인다. */
export function assigneeChoices(options: FormOptions, current: string): AssigneeChoice[] {
  const out: AssigneeChoice[] = [{ value: '', label: '담당 없음' }]
  for (const e of options.employees)
    out.push({ value: e.id, label: e.title ? `${e.name} (${e.title})` : e.name })
  if (current !== '' && !out.some((c) => c.value === current))
    out.push({ value: current, label: `${current} (조직에 없음)` })
  return out
}

/** 선택한 프로젝트가 PM 필요 상태인지. */
export const needsPm = (options: FormOptions, projectId: string): boolean =>
  options.projects.find((p) => p.id === projectId)?.state === 'pm-required'

export const PM_REQUIRED_NOTE = 'PM이 없어서 이 티켓은 PM이 지정될 때까지 실행되지 않아요.'

export function saveErrorText(code: DomainErrorCode | 'unknown', message: string): string {
  switch (code) {
    case 'invalid-request':
      return message !== '' ? message : '입력한 내용을 확인해 주세요.'
    case 'not-found':
      return '티켓을 찾을 수 없어요. 다른 곳에서 옮겨졌거나 지워졌을 수 있어요.'
    case 'forbidden':
      return '진행 중이거나 끝난 티켓은 고칠 수 없어요.'
    case 'conflict':
      return '다른 곳에서 이 티켓이 먼저 바뀌었어요.'
    case 'no-company':
      return '열린 회사가 없어요. 회사를 먼저 열어 주세요.'
    case 'not-implemented':
      return '이 버전의 앱은 아직 티켓 저장을 지원하지 않아요.'
    default:
      return '저장하지 못했어요. 바뀐 것은 없어요. 잠시 뒤 다시 시도해 주세요.'
  }
}
