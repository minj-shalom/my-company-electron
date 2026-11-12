import type { WindowApi } from '../../../shared/api'
import {
  DECISION_KINDS,
  type Decision,
  type DecisionKind,
  type DecisionList,
  type DecisionProposer,
  type DecisionStatus,
  type UnreadableDecision,
  type UnreadableReason
} from '../../../shared/decision'
import type { DomainErrorCode } from '../../../shared/result'
import type { BadgeTone } from '../ui/Badge'

export interface KindMeta {
  label: string
  /** 이모지 대신 쓰는 한 글자 표식. 장식이므로 스크린리더에는 label을 읽힌다. */
  glyph: string
  tone: BadgeTone
  /** 필터 칩과 카드에 붙는 한 줄 설명. */
  hint: string
}

export const KIND_META: Record<DecisionKind, KindMeta> = {
  decision: {
    label: '일반 결정',
    glyph: '결',
    tone: 'info',
    hint: '선택지 중 하나를 골라 주세요.'
  },
  permission: {
    label: '권한 거부',
    glyph: '권',
    tone: 'warn',
    hint: '직원이 막힌 권한을 허용할지 정해 주세요.'
  },
  proposal: {
    label: '제안',
    glyph: '제',
    tone: 'info',
    hint: '배정·조직·정책 변경 제안을 검토해 주세요.'
  },
  'content-approval': {
    label: '콘텐츠 승인',
    glyph: '글',
    tone: 'good',
    hint: '발행 전 초안을 확인해 주세요.'
  },
  'integrity-warning': {
    label: '무결성 경고',
    glyph: '!',
    tone: 'bad',
    hint: '검증에 실패했어요. 복원할지 정해 주세요.'
  },
  'revert-suggestion': {
    label: '되돌리기 제안',
    glyph: '↺',
    tone: 'warn',
    hint: '승인 없이 바뀐 변경을 되돌릴지 정해 주세요.'
  },
  'git-confirm': {
    label: 'Git 컨펌',
    glyph: 'G',
    tone: 'info',
    hint: '푸시·PR·머지 진행을 확인해 주세요.'
  }
}

export type KindFilter = 'all' | DecisionKind

/** 허용 목록 밖이거나 없는 유형은 일반 결정으로 취급한다 (목록을 깨지 않는다). */
export function normalizeKind(value: unknown): DecisionKind {
  return DECISION_KINDS.find((k) => k === value) ?? 'decision'
}

export function kindOf(d: Pick<Decision, 'kind'>): DecisionKind {
  return normalizeKind(d.kind)
}

export function filterByKind(items: readonly Decision[], filter: KindFilter): Decision[] {
  return filter === 'all' ? [...items] : items.filter((d) => kindOf(d) === filter)
}

export function countByKind(items: readonly Decision[]): Record<DecisionKind, number> {
  const counts = Object.fromEntries(DECISION_KINDS.map((k) => [k, 0])) as Record<
    DecisionKind,
    number
  >
  for (const d of items) counts[kindOf(d)] += 1
  return counts
}

export function proposerLabel(p: DecisionProposer | null | undefined): string | null {
  if (p === 'hr') return '인사(hr)'
  if (p === 'coo') return 'COO'
  return null
}

function idNumber(id: string): number {
  const n = Number(/(\d+)$/.exec(id)?.[1])
  return Number.isFinite(n) ? n : 0
}

/** pending은 오래된 것부터, done은 최근 것부터 보여 준다. */
export function splitDecisions(items: readonly Decision[]): {
  pending: Decision[]
  done: Decision[]
} {
  const by = (s: DecisionStatus): Decision[] => items.filter((d) => d.status === s)
  return {
    pending: by('pending').sort((a, b) => idNumber(a.id) - idNumber(b.id)),
    done: by('done').sort((a, b) => idNumber(b.id) - idNumber(a.id))
  }
}

// ---- unreadable ----

export const UNREADABLE_TEXT: Record<UnreadableReason, string> = {
  unreadable: '읽을 수 없는 파일이에요',
  duplicate: '같은 번호의 카드가 둘 이상 있어 숨겼어요',
  'too-large': '파일이 너무 커서 읽지 않았어요'
}

export function unreadableReasonText(reason: unknown): string {
  return (
    (typeof reason === 'string' && Object.hasOwn(UNREADABLE_TEXT, reason)
      ? UNREADABLE_TEXT[reason as UnreadableReason]
      : undefined) ?? UNREADABLE_TEXT.unreadable
  )
}

export function unreadableSummary(count: number): string {
  return `읽지 못한 카드 ${count}건 (파일 확인 필요)`
}

/**
 * status 필터 없이 받으면 두 폴더의 항목이 섞여 있으므로 경로로 해당 폴더 것만 남긴다.
 * main은 `company/decisions/<status>/...`를 주므로 접두어가 아니라 세그먼트 포함 여부로 판정한다. 폴더를 알 수 없는 경로는 숨기지 않는다.
 */
export function filterUnreadable(
  list: readonly UnreadableDecision[],
  status: DecisionStatus
): UnreadableDecision[] {
  const other = status === 'pending' ? 'done' : 'pending'
  const needle = `/decisions/${other}/`
  return list.filter((u) => !`/${u.path.replaceAll('\\', '/')}`.includes(needle))
}

// ---- 오류 문구 ----

/** main 메시지와 경로는 표시하지 않고 코드로만 문구를 정한다. */
export function resolveErrorText(code: DomainErrorCode | 'unknown'): string {
  switch (code) {
    case 'invalid-request':
      return '요청이 올바르지 않아요. 선택과 메모를 확인해 주세요.'
    case 'not-found':
      return '카드를 찾을 수 없어요. 이미 다른 곳에서 옮겨졌을 수 있어요.'
    case 'conflict':
      return '이미 처리된 카드예요. 목록을 새로 불러왔어요.'
    case 'no-company':
      return '열린 회사가 없어요. 회사를 먼저 열어 주세요.'
    case 'not-implemented':
      return '이 버전의 앱은 아직 결재 처리를 지원하지 않아요.'
    default:
      return '처리하지 못했어요. 잠시 뒤 다시 시도해 주세요.'
  }
}

export function loadErrorText(code: DomainErrorCode | 'unknown'): string {
  switch (code) {
    case 'no-company':
      return '열린 회사가 없어요. 회사를 먼저 열어 주세요.'
    case 'not-implemented':
      return '이 버전의 앱은 아직 결재함 조회를 지원하지 않아요.'
    default:
      return '결재함을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.'
  }
}

/** 카드가 이미 옮겨졌거나 없어진 경우라 화면 목록이 낡았다는 뜻이므로 다시 읽는다. */
export function shouldRefreshAfterError(code: DomainErrorCode): boolean {
  return code === 'conflict' || code === 'not-found'
}

// ---- 메모 ----

export const MEMO_MAX = 2000

/** 제어문자(개행·탭 포함, 한 줄 입력이므로)를 제거하고 길이를 자른다. 최종 검증은 main이 한다. */
export function sanitizeMemo(raw: string): string {
  // eslint-disable-next-line no-control-regex
  const clean = raw.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, '')
  if (clean.length <= MEMO_MAX) return clean
  // 서로게이트 쌍 한가운데를 자르면 깨진 문자가 남으므로 앞 절반이 걸리면 한 칸 줄인다.
  const cut = /[\ud800-\udbff]/.test(clean[MEMO_MAX - 1]) ? MEMO_MAX - 1 : MEMO_MAX
  return clean.slice(0, cut)
}

// ---- 새로고침 정책 ----

/** main 이벤트가 생기기 전까지 쓰는 임시 폴링 간격. */
export const POLL_INTERVAL_MS = 30_000
/** 포커스가 연달아 오갈 때 요청이 몰리지 않게 하는 최소 간격. */
export const FOCUS_MIN_GAP_MS = 3_000

export function shouldRefetchOnFocus(lastFetchAt: number | null, now: number): boolean {
  return lastFetchAt === null || now - lastFetchAt >= FOCUS_MIN_GAP_MS
}

// ---- 불러오기 ----

export type DecisionsState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | {
      kind: 'ready'
      items: Decision[]
      unreadable: UnreadableDecision[]
      /** 다시 읽기에 실패해 이전 목록을 보여 주는 중. */
      stale: boolean
    }

export async function loadDecisionState(
  api: Pick<WindowApi, 'listDecisions'>
): Promise<DecisionsState> {
  try {
    const r = await api.listDecisions()
    if (!r.ok) return { kind: 'error', message: loadErrorText(r.code) }
    const list: DecisionList = r.value
    return {
      kind: 'ready',
      items: Array.isArray(list.items) ? list.items : [],
      unreadable: Array.isArray(list.unreadable) ? list.unreadable : [],
      stale: false
    }
  } catch {
    return { kind: 'error', message: loadErrorText('unknown') }
  }
}

/** 다시 읽기 결과를 합친다. 실패하면 이미 보이던 목록은 지우지 않고 stale로 표시한다. */
export function mergeRefresh(prev: DecisionsState, next: DecisionsState): DecisionsState {
  if (next.kind === 'error' && prev.kind === 'ready') return { ...prev, stale: true }
  return next
}

/** 처리 성공한 카드를 응답 값으로 바로 바꿔 done으로 옮겨 보인다. */
export function applyResolved(prev: DecisionsState, resolved: Decision): DecisionsState {
  if (prev.kind !== 'ready') return prev
  const items = prev.items.some((d) => d.id === resolved.id)
    ? prev.items.map((d) => (d.id === resolved.id ? resolved : d))
    : [...prev.items, resolved]
  return { ...prev, items }
}

export function pendingCount(state: DecisionsState): number {
  return state.kind === 'ready' ? state.items.filter((d) => d.status === 'pending').length : 0
}

/**
 * 조회 응답의 세대 가드. 조회를 시작한 뒤 resolve가 끝나거나 강제 재조회가 시작되면 그 이전 응답은 낡은 것이므로 버린다
 * (낡은 응답이 방금 처리한 카드를 pending으로 되살리는 것을 막는다).
 */
export interface RefreshGuard {
  begin: () => number
  invalidate: () => void
  isCurrent: (token: number) => boolean
}

export function createRefreshGuard(): RefreshGuard {
  let gen = 0
  return {
    begin: () => gen,
    invalidate: () => {
      gen += 1
    },
    isCurrent: (token) => token === gen
  }
}

/** 연타 방지. state 반영 전에도 즉시 잠그도록 ref 객체로 잠금을 받는다. 이미 실행 중이면 fn을 호출하지 않는다. */
export async function runExclusive<T>(
  lock: { current: boolean },
  fn: () => Promise<T>
): Promise<{ ran: true; value: T } | { ran: false }> {
  if (lock.current) return { ran: false }
  lock.current = true
  try {
    return { ran: true, value: await fn() }
  } finally {
    lock.current = false
  }
}

export type ConfirmTransition = 'open' | 'back' | 'failure' | 'edit'

/**
 * 확정 단계가 바뀔 때 포커스를 옮길 곳. 버튼으로 단계가 바뀔 때만 옮기고,
 * 입력·라디오 변경으로 확정이 풀리는 경우(edit)는 사용자가 입력 중이므로 옮기지 않는다.
 */
export function focusAfterTransition(t: ConfirmTransition): 'confirm' | 'check' | null {
  if (t === 'open') return 'confirm'
  if (t === 'back' || t === 'failure') return 'check'
  return null
}
