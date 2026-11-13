import type { WindowApi } from '../../../shared/api'
import { hasForbiddenChar, type ProjectInfo } from '../../../shared/project'
import {
  MAX_RECURRING_COUNT,
  MAX_RECURRING_DEFS,
  RECURRING_ID,
  WEEKDAY_CHARS,
  type RecurringCadence,
  type RecurringDefinition,
  type RecurringItem,
  type RecurringList,
  type WeekdayChar
} from '../../../shared/recurring'
import type { DomainErrorCode } from '../../../shared/result'

export type RecurringLoad =
  { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; list: RecurringList }

const LOAD_ERROR = '반복 업무를 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.'

export async function loadRecurring(api: Pick<WindowApi, 'listRecurring'>): Promise<RecurringLoad> {
  try {
    const r = await api.listRecurring()
    if (!r.ok)
      return {
        kind: 'error',
        message: r.code === 'no-company' ? recurringErrorText(r.code) : LOAD_ERROR
      }
    return { kind: 'ready', list: r.value }
  } catch {
    return { kind: 'error', message: LOAD_ERROR }
  }
}

const ERRORS: Partial<Record<DomainErrorCode, string>> = {
  'invalid-request': '입력한 내용을 저장할 수 없어요. 제목과 목표, 완료 조건을 확인해 주세요.',
  conflict: '같은 반복 업무가 이미 있거나 다른 곳에서 바뀌었어요. 목록을 새로 불러와 주세요.',
  'not-found': '반복 업무를 찾지 못했어요. 목록을 새로 불러와 주세요.',
  'no-company': '열린 회사가 없어요. 회사를 다시 열어 주세요.'
}
const GENERIC = '처리하지 못했어요. 바뀐 것은 없어요. 잠시 뒤 다시 시도해 주세요.'

/** main의 메시지에는 내부 표현이 섞일 수 있어 코드별 쉬운 문장만 보여 준다. */
export function recurringErrorText(code: unknown): string {
  return (
    (typeof code === 'string' && Object.hasOwn(ERRORS, code)
      ? ERRORS[code as DomainErrorCode]
      : undefined) ?? GENERIC
  )
}

export type RecurringActionResult = { ok: true; message: string } | { ok: false; message: string }

export async function runRecurringAction(
  task: () => Promise<{ ok: true } | { ok: false; code: unknown }>,
  success: string
): Promise<RecurringActionResult> {
  try {
    const r = await task()
    return r.ok
      ? { ok: true, message: success }
      : { ok: false, message: recurringErrorText(r.code) }
  } catch {
    return { ok: false, message: GENERIC }
  }
}

export const CADENCE_KINDS = ['daily', 'weekdays', 'weekly'] as const
export type CadenceKind = (typeof CADENCE_KINDS)[number]
export const CADENCE_KIND_LABELS: Record<CadenceKind, string> = {
  daily: '매일',
  weekdays: '평일(월-금)',
  weekly: '매주'
}

export function cadenceLabel(c: RecurringCadence): string {
  if (c === 'daily') return '매일'
  if (c === 'weekdays') return '평일(월-금)'
  return `매주 ${c.slice('weekly:'.length)}요일`
}

export function cadenceParts(c: RecurringCadence): { kind: CadenceKind; day: WeekdayChar } {
  if (c === 'daily' || c === 'weekdays') return { kind: c, day: '월' }
  return { kind: 'weekly', day: c.slice('weekly:'.length) as WeekdayChar }
}

export function buildCadence(kind: CadenceKind, day: WeekdayChar): RecurringCadence {
  return kind === 'weekly' ? `weekly:${day}` : kind
}

/** 다음 생성 예정 문구. 실제 생성은 그 시각 뒤 첫 자동 점검 때다. */
export function nextRunText(item: RecurringItem, now: number): string {
  if (item.status === 'paused') return '일시정지 중이라 만들지 않아요'
  if (item.nextRunAt === null) return '예정 없음'
  if (item.nextRunAt <= now)
    return item.createdToday ? '오늘 몫은 만들었어요' : '다음 자동 점검 때 만들어요'
  const d = new Date(item.nextRunAt)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${d.getMonth() + 1}월 ${d.getDate()}일(${WEEKDAY_CHARS[d.getDay()]}) ${hh}:${mm} 이후`
}

export interface GoalNote {
  projectId: string
  goal: number
  /** 활성인 매일·평일 반복 업무가 하루에 만드는 티켓 수. */
  perDay: number
  mismatch: boolean
}

/**
 * 프로젝트별 일일 산출 목표와 반복 업무 개수 비교. 목표가 0(없음)이면 비교하지 않는다.
 * 매주 업무는 하루 몫에 넣지 않는다 (요일이 정해져 있어 매일의 목표와 직접 비교되지 않는다).
 */
export function goalNotes(
  items: readonly RecurringItem[],
  goals: ReadonlyMap<string, number>
): Map<string, GoalNote> {
  const out = new Map<string, GoalNote>()
  for (const projectId of new Set(items.map((i) => i.projectId))) {
    const goal = goals.get(projectId) ?? 0
    const perDay = items
      .filter((i) => i.projectId === projectId && i.status === 'active')
      .filter((i) => i.cadence === 'daily' || i.cadence === 'weekdays')
      .reduce((n, i) => n + i.count, 0)
    out.set(projectId, { projectId, goal, perDay, mismatch: goal > 0 && goal !== perDay })
  }
  return out
}

export interface Draft {
  projectId: string
  title: string
  goal: string
  /** 한 줄에 하나. */
  criteria: string
  cadenceKind: CadenceKind
  day: WeekdayChar
  count: string
  /** 빈 문자열은 프로젝트의 담당 PM. */
  assignee: string
}

export const emptyDraft = (projectId: string): Draft => ({
  projectId,
  title: '',
  goal: '',
  criteria: '',
  cadenceKind: 'daily',
  day: '월',
  count: '1',
  assignee: ''
})

export function draftOf(d: RecurringDefinition): Draft {
  const c = cadenceParts(d.cadence)
  return {
    projectId: d.projectId,
    title: d.titleTemplate,
    goal: d.goalTemplate,
    criteria: d.criteriaTemplates.join('\n'),
    cadenceKind: c.kind,
    day: c.day,
    count: String(d.count),
    assignee: d.assignee ?? ''
  }
}

const MAX_CRITERIA = 10
const oneLine = (v: string, max: number): boolean =>
  v === v.trim() && v.length > 0 && [...v].length <= max && !hasForbiddenChar(v)

export const splitCriteria = (v: string): string[] =>
  v
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '')

export type DraftErrors = Partial<
  Record<'project' | 'title' | 'goal' | 'criteria' | 'count', string>
>

export function validateDraft(d: Draft): DraftErrors {
  const e: DraftErrors = {}
  if (d.projectId === '') e.project = '프로젝트를 골라 주세요.'
  if (!oneLine(d.title.trim(), 300)) e.title = '제목을 300자 이하 한 줄로 적어 주세요.'
  if (!oneLine(d.goal.trim(), 2000)) e.goal = '목표를 한 줄로 적어 주세요.'
  const lines = splitCriteria(d.criteria)
  if (lines.length < 1 || lines.length > MAX_CRITERIA || !lines.every((l) => oneLine(l, 300)))
    e.criteria = `완료 조건을 한 줄에 하나씩, 1~${MAX_CRITERIA}개 적어 주세요.`
  const n = Number(d.count)
  if (!Number.isInteger(n) || n < 1 || n > MAX_RECURRING_COUNT)
    e.count = `개수는 1~${MAX_RECURRING_COUNT} 사이로 정해 주세요.`
  return e
}

/** 사용자가 보는 값이 아니라 저장용 식별자다. 겹치지 않는 값을 만든다. */
export function newRecurringId(
  existing: ReadonlySet<string>,
  rand: () => number = Math.random
): string {
  for (;;) {
    const id = `rec-${Math.floor(rand() * 36 ** 6)
      .toString(36)
      .padStart(6, '0')}`
    if (RECURRING_ID.test(id) && !existing.has(id)) return id
  }
}

export function toDefinition(
  d: Draft,
  id: string,
  status: RecurringDefinition['status']
): RecurringDefinition {
  return {
    id,
    projectId: d.projectId,
    titleTemplate: d.title.trim(),
    goalTemplate: d.goal.trim(),
    criteriaTemplates: splitCriteria(d.criteria),
    cadence: buildCadence(d.cadenceKind, d.day),
    count: Number(d.count),
    assignee: d.assignee === '' ? null : d.assignee,
    status
  }
}

export const TOO_MANY = `반복 업무는 ${MAX_RECURRING_DEFS}개까지 둘 수 있어요.`

export function projectName(projects: readonly ProjectInfo[], id: string): string {
  return projects.find((p) => p.id === id)?.name ?? '찾을 수 없는 프로젝트'
}
