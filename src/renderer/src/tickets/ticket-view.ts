import type { WindowApi } from '../../../shared/api'
import type { OrgSnapshot } from '../../../shared/org'
import type { DomainErrorCode } from '../../../shared/result'
import {
  TICKET_STATUSES,
  type Ticket,
  type TicketList,
  type TicketStatus,
  type UnreadableTicket
} from '../../../shared/ticket'
import { unreadableReasonTextFor, unreadableTexts } from '../lib/refresh'
import type { BadgeTone } from '../ui/Badge'

// ---- 열 ----

export const COLUMN_LABEL: Record<TicketStatus, string> = {
  backlog: '대기',
  'in-progress': '진행 중',
  done: '완료'
}

function idNumber(id: string): number {
  const n = Number(/(\d+)$/.exec(id)?.[1])
  return Number.isFinite(n) ? n : 0
}

/** 알 수 없는 상태의 항목은 어느 열에도 넣지 않는다. 대기·진행 중은 번호 순, 완료는 최근(큰 번호) 순. */
export function groupByStatus(items: readonly Ticket[]): Record<TicketStatus, Ticket[]> {
  const out: Record<TicketStatus, Ticket[]> = { backlog: [], 'in-progress': [], done: [] }
  for (const t of items) if (TICKET_STATUSES.includes(t.status)) out[t.status].push(t)
  out.backlog.sort((a, b) => idNumber(a.id) - idNumber(b.id))
  out['in-progress'].sort((a, b) => idNumber(a.id) - idNumber(b.id))
  out.done.sort((a, b) => idNumber(b.id) - idNumber(a.id))
  return out
}

// ---- 담당 배지 ----

export type AssigneeBadge = 'none' | 'missing'

export const ASSIGNEE_BADGE_TEXT: Record<AssigneeBadge, string> = {
  none: '담당 없음',
  missing: '담당 직원 없음 (채용 필요)'
}

export const ASSIGNEE_BADGE_TONE: Record<AssigneeBadge, BadgeTone> = {
  none: 'neutral',
  missing: 'info'
}

export function assigneeOf(t: Pick<Ticket, 'assignee'>): string | null {
  return typeof t.assignee === 'string' && t.assignee.trim() !== '' ? t.assignee : null
}

/**
 * 담당 상태 배지. 둘 다 오류가 아니다 (새 회사에는 pm·developer가 없다).
 * hired가 null이면 조직도를 읽지 못한 것이므로 "직원 없음" 판정은 건너뛴다.
 */
export function assigneeBadge(
  t: Pick<Ticket, 'assignee'>,
  hired: ReadonlySet<string> | null
): AssigneeBadge | null {
  const a = assigneeOf(t)
  if (a === null) return 'none'
  if (hired === null) return null
  return hired.has(a) ? null : 'missing'
}

/** 이 코드가 있으면 표가 없거나 읽히지 않은 것이라 직원 유무를 판단할 수 없다. */
const ORG_UNUSABLE = new Set(['missing-org', 'unreadable', 'file-too-large', 'no-table'])

/** 조직도에서 직원 id(에이전트)를 모은다. 조직도를 쓸 수 없으면 null. */
export function hiredIds(snapshot: OrgSnapshot): string[] | null {
  const org = snapshot?.org
  if (!org || !Array.isArray(org.members)) return null
  if (Array.isArray(org.issues) && org.issues.some((i) => ORG_UNUSABLE.has(i.code))) return null
  const ids: string[] = []
  for (const m of org.members) if (m.kind === 'agent' && m.agentId) ids.push(m.agentId)
  return ids
}

// ---- 부서 ----

export function departmentOf(t: Pick<Ticket, 'department'>): string | null {
  return typeof t.department === 'string' && t.department.trim() !== '' ? t.department : null
}

// ---- 필터 ----

/**
 * 필터 값: null = 전체, '' = 값 없음(부서 없음 / 담당 없음), 그 밖 = 해당 값.
 * 프로젝트 필터(T-042)도 같은 모양의 필드로 끼운다.
 */
export type FilterValue = string | null
export interface TicketFilters {
  department: FilterValue
  assignee: FilterValue
}

export const NO_FILTERS: TicketFilters = { department: null, assignee: null }

function matches(value: string | null, f: FilterValue): boolean {
  return f === null || (value ?? '') === f
}

export function applyFilters(items: readonly Ticket[], f: TicketFilters): Ticket[] {
  return items.filter(
    (t) => matches(departmentOf(t), f.department) && matches(assigneeOf(t), f.assignee)
  )
}

export interface FilterOption {
  key: FilterValue
  label: string
  count: number
}

export const NO_DEPARTMENT_LABEL = '부서 없음'
export const NO_ASSIGNEE_LABEL = '담당 없음'

function options(
  items: readonly Ticket[],
  pick: (t: Ticket) => string | null,
  emptyLabel: string,
  selected: FilterValue,
  /** 이 필터를 뺀 나머지 필터를 적용한 목록. 칩의 개수는 이 목록 기준이다. */
  counted: readonly Ticket[]
): FilterOption[] {
  const values = new Set<string>()
  let hasEmpty = false
  for (const t of items) {
    const v = pick(t)
    if (v === null) hasEmpty = true
    else values.add(v)
  }
  // 선택한 값이 목록에서 사라져도 칩을 남겨 해제할 수 있게 한다.
  if (selected === '') hasEmpty = true
  else if (selected !== null) values.add(selected)
  const count = (key: string): number => counted.filter((t) => (pick(t) ?? '') === key).length
  const named = [...values]
    .sort((a, b) => a.localeCompare(b, 'ko'))
    .map((v) => ({ key: v, label: v, count: count(v) }))
  const empty: FilterOption[] = hasEmpty ? [{ key: '', label: emptyLabel, count: count('') }] : []
  // 담당은 "담당 없음"을 앞에 둔다 (채용·배정이 필요한 항목을 먼저 보이게).
  return emptyLabel === NO_ASSIGNEE_LABEL ? [...empty, ...named] : [...named, ...empty]
}

/** 부서 칩. 개수는 담당 필터를 적용한 결과 기준이다. */
export function departmentOptions(items: readonly Ticket[], f: TicketFilters): FilterOption[] {
  const counted = items.filter((t) => matches(assigneeOf(t), f.assignee))
  return [
    { key: null, label: '전체', count: counted.length },
    ...options(items, departmentOf, NO_DEPARTMENT_LABEL, f.department, counted)
  ]
}

/** 담당 칩. 개수는 부서 필터를 적용한 결과 기준이다. */
export function assigneeOptions(items: readonly Ticket[], f: TicketFilters): FilterOption[] {
  const counted = items.filter((t) => matches(departmentOf(t), f.department))
  return [
    { key: null, label: '전체', count: counted.length },
    ...options(items, assigneeOf, NO_ASSIGNEE_LABEL, f.assignee, counted)
  ]
}

export function hasActiveFilter(f: TicketFilters): boolean {
  return f.department !== null || f.assignee !== null
}

// ---- 이동 ----

export function moveTargets(from: TicketStatus): TicketStatus[] {
  return TICKET_STATUSES.filter((s) => s !== from)
}

/** main도 검증하지만, 같은 열이거나 허용 밖의 값은 요청을 보내기 전에 막는다. */
export function canMove(from: TicketStatus, to: unknown): to is TicketStatus {
  return TICKET_STATUSES.some((s) => s === to) && to !== from
}

/** main 메시지와 경로는 표시하지 않고 코드로만 문구를 정한다. */
export function moveErrorText(code: DomainErrorCode | 'unknown'): string {
  switch (code) {
    case 'invalid-request':
      return '요청이 올바르지 않아요. 목록을 새로 불러왔어요.'
    case 'not-found':
      return '티켓을 찾을 수 없어요. 이미 다른 곳에서 옮겨졌을 수 있어요. 목록을 새로 불러왔어요.'
    case 'conflict':
      return '옮기려는 열에 같은 번호의 파일이 이미 있어요. 목록을 새로 불러왔어요.'
    case 'no-company':
      return '열린 회사가 없어요. 회사를 먼저 열어 주세요.'
    case 'not-implemented':
      return '이 버전의 앱은 아직 티켓 이동을 지원하지 않아요.'
    default:
      return '옮기지 못했어요. 잠시 뒤 다시 시도해 주세요.'
  }
}

export function loadErrorText(code: DomainErrorCode | 'unknown'): string {
  switch (code) {
    case 'no-company':
      return '열린 회사가 없어요. 회사를 먼저 열어 주세요.'
    case 'not-implemented':
      return '이 버전의 앱은 아직 티켓 조회를 지원하지 않아요.'
    default:
      return '티켓을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.'
  }
}

/** 화면 목록이 낡았다는 뜻이므로 다시 읽는다. */
export function shouldRefreshAfterMoveError(code: DomainErrorCode): boolean {
  return code === 'conflict' || code === 'not-found' || code === 'invalid-request'
}

export function moveSuccessText(id: string, to: TicketStatus): string {
  return `${id}을(를) '${COLUMN_LABEL[to]}' 열로 옮겼어요.`
}

// ---- unreadable ----

const UNREADABLE_TEXT = unreadableTexts('티켓이')

export function ticketUnreadableText(reason: unknown): string {
  return unreadableReasonTextFor(UNREADABLE_TEXT, reason)
}

export function ticketUnreadableSummary(count: number): string {
  return `읽지 못한 티켓 ${count}건`
}

// ---- 본문 ----

export const TRUNCATED_NOTE = '본문이 길어 일부만 보여요'

// ---- 불러오기 ----

export type TicketsState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | {
      kind: 'ready'
      items: Ticket[]
      unreadable: UnreadableTicket[]
      /** 조직도의 직원 id. 조직도를 읽지 못했으면 null (배지 판정을 건너뛴다). */
      hired: string[] | null
      /** 다시 읽기에 실패해 이전 목록을 보여 주는 중. */
      stale: boolean
    }

export async function loadTicketState(
  api: Pick<WindowApi, 'listTickets' | 'getOrg'>
): Promise<TicketsState> {
  const [list, org] = await Promise.all([
    api.listTickets().catch(() => null),
    api.getOrg().catch(() => null)
  ])
  if (!list) return { kind: 'error', message: loadErrorText('unknown') }
  if (!list.ok) return { kind: 'error', message: loadErrorText(list.code) }
  const value: TicketList = list.value
  return {
    kind: 'ready',
    items: Array.isArray(value.items) ? value.items : [],
    unreadable: Array.isArray(value.unreadable) ? value.unreadable : [],
    hired: org && org.ok ? hiredIds(org.value) : null,
    stale: false
  }
}

/** 다시 읽기 결과를 합친다. 실패하면 이미 보이던 목록은 지우지 않고 stale로 표시한다. */
export function mergeRefresh(prev: TicketsState, next: TicketsState): TicketsState {
  if (next.kind === 'error' && prev.kind === 'ready') return { ...prev, stale: true }
  return next
}

/** 이동 성공한 티켓을 응답의 상태로 바로 옮겨 보인다. 본문은 목록의 것을 유지한다. */
export function applyMoved(prev: TicketsState, moved: Pick<Ticket, 'id' | 'status'>): TicketsState {
  if (prev.kind !== 'ready') return prev
  return {
    ...prev,
    items: prev.items.map((t) => (t.id === moved.id ? { ...t, status: moved.status } : t))
  }
}
