/** 실행 로그 뷰의 순수 로직: 이벤트 분류, 실행별 묶기, 상한/윈도잉, 길이 자르기, 상태 전이. */

import type { RunErrorCode } from '../../../shared/run'

export const MAX_ENTRIES_PER_RUN = 2000
export const MAX_RUNS = 20
/** 이벤트 한 건의 본문 상한(글자). 넘으면 잘라 표시한다. */
export const MAX_BODY_CHARS = 20_000
export const WINDOW_STEP = 200
export const RUN_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/
/** 도구 입력 직렬화 전에 허용하는 문자열 총량(글자). 넘으면 직렬화를 중단한다. */
const MAX_INPUT_CHARS = 200_000
export const AUTOSCROLL_THRESHOLD_PX = 24

export type RunStatus = 'pending' | 'running' | 'done' | 'error' | 'cancelled'
export type LogKind = 'message' | 'tool' | 'result' | 'error' | 'other'

export const KIND_LABEL: Record<LogKind, string> = {
  message: '메시지',
  tool: '도구',
  result: '결과',
  error: '오류',
  other: '기타'
}

export const STATUS_LABEL: Record<RunStatus, string> = {
  pending: '대기',
  running: '실행 중',
  done: '완료',
  error: '오류',
  cancelled: '취소됨'
}

export interface LogEntry {
  /** 실행 안에서 증가하는 번호. React key로 쓴다. */
  seq: number
  kind: LogKind
  /** 짧은 머리말 (예: 어시스턴트, 도구 이름). */
  title: string
  /** 텍스트로만 렌더링한다. */
  text: string
  truncated: boolean
  /** tool_result의 isError 등 강조가 필요한 항목. */
  failed: boolean
}

export interface UsageSummary {
  costUsd: number | null
  durationMs: number | null
  numTurns: number | null
}

export interface RunLog {
  runId: string
  status: RunStatus
  entries: LogEntry[]
  /** 상한 때문에 버린 오래된 이벤트 수. */
  dropped: number
  /** 화면에 그릴 최근 N건. */
  visible: number
  usage: UsageSummary | null
  nextSeq: number
  /** 이미 처리한 도구 호출 id (중복 이벤트 방어). */
  seenTools: string[]
  finished: boolean
  sawCancel: boolean
}

export interface RunLogState {
  order: string[]
  runs: Record<string, RunLog>
}

export const EMPTY_STATE: RunLogState = { order: [], runs: {} }

const ERROR_TEXT: Record<RunErrorCode, string> = {
  'invalid-request': '요청이 올바르지 않아 실행하지 못했어요.',
  'cli-not-found': 'Claude CLI를 찾지 못했어요.',
  'spawn-failed': '실행을 시작하지 못했어요.',
  timeout: '시간이 오래 걸려 실행을 멈췄어요.',
  cancelled: '실행을 취소했어요.',
  'exit-nonzero': '실행이 오류로 끝났어요.'
}
const GENERIC_ERROR = '실행 중 오류가 났어요.'

/** main이 준 message는 내부 정보를 담을 수 있어 쓰지 않고 코드별 고정 문구만 보여 준다. */
export function errorText(code: unknown): string {
  return typeof code === 'string' && Object.hasOwn(ERROR_TEXT, code)
    ? ERROR_TEXT[code as RunErrorCode]
    : GENERIC_ERROR
}

export function truncateText(
  text: string,
  max: number = MAX_BODY_CHARS
): { text: string; truncated: boolean } {
  return text.length > max
    ? { text: text.slice(0, max), truncated: true }
    : { text, truncated: false }
}

const TOO_BIG = Symbol('too-big')

/** 거대한 입력은 직렬화 도중 중단해 CPU와 메모리를 제한한다. */
function safeStringify(value: unknown): string {
  if (typeof value === 'string') return value
  let budget = MAX_INPUT_CHARS
  try {
    return (
      JSON.stringify(
        value,
        (_k, v: unknown) => {
          budget -= typeof v === 'string' ? v.length + 1 : 8
          if (budget < 0) throw TOO_BIG
          return v
        },
        2
      ) ?? ''
    )
  } catch (e) {
    return e === TOO_BIG ? '(입력이 너무 커서 표시하지 않았어요.)' : ''
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const numOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

export interface ClassifiedEvent {
  runId: string
  entry: Omit<LogEntry, 'seq'> | null
  /** 도구 id 중복 방어용. */
  toolKey: string | null
  type: string
  data: Record<string, unknown>
}

/** 알 수 없는 입력은 버리지 않고 '기타'로 분류한다. runId가 없는 값만 null. */
export function classifyEvent(raw: unknown): ClassifiedEvent | null {
  if (!isRecord(raw)) return null
  const runId = raw.runId
  // 객체 키로 쓰이므로 형식을 좁힌다. 어긋나면 조용히 버린다 (고정 안내도 남기지 않는다).
  if (typeof runId !== 'string' || !RUN_ID_PATTERN.test(runId)) return null
  const type = typeof raw.type === 'string' ? raw.type : ''
  const mk = (
    kind: LogKind,
    title: string,
    body: string,
    failed = false,
    toolKey: string | null = null
  ): ClassifiedEvent => {
    const t = truncateText(body)
    return {
      runId,
      type,
      data: raw,
      toolKey,
      entry: { kind, title, text: t.text, truncated: t.truncated, failed }
    }
  }
  switch (type) {
    case 'start':
      return { runId, type, data: raw, toolKey: null, entry: null }
    case 'message':
      return mk('message', raw.role === 'user' ? '사용자' : '어시스턴트', str(raw.text))
    case 'tool_use': {
      const name = str(raw.name).slice(0, 80) || '도구'
      return mk('tool', name, safeStringify(raw.input), false, `use:${str(raw.toolUseId)}`)
    }
    case 'tool_result':
      return mk(
        'result',
        raw.isError === true ? '도구 오류' : '도구 결과',
        str(raw.content),
        raw.isError === true,
        `res:${str(raw.toolUseId)}`
      )
    case 'result':
      return mk(
        'result',
        raw.success === true ? '최종 결과' : '실행 실패',
        str(raw.text),
        raw.success !== true
      )
    case 'error':
      return mk('error', '오류', errorText(raw.code), true)
    case 'log':
      return mk('other', raw.source === 'stderr' ? 'stderr' : 'stdout', str(raw.line))
    case 'exit':
      return { runId, type, data: raw, toolKey: null, entry: null }
    default:
      return mk('other', '알 수 없는 이벤트', '지원하지 않는 이벤트 종류예요.')
  }
}

const getRun = (state: RunLogState, runId: string): RunLog | null =>
  Object.hasOwn(state.runs, runId) ? state.runs[runId] : null

function newRun(runId: string): RunLog {
  return {
    runId,
    status: 'pending',
    entries: [],
    dropped: 0,
    visible: WINDOW_STEP,
    usage: null,
    nextSeq: 1,
    seenTools: [],
    finished: false,
    sawCancel: false
  }
}

/**
 * 시작 요청 직후, 첫 이벤트 전의 '대기' 실행을 등록한다.
 * 지금은 테스트에서만 쓴다. 실행 시작 UI(후속 티켓)가 startRun 응답의 runId로 호출할 자리다.
 */
export function registerRun(state: RunLogState, runId: string): RunLogState {
  if (!RUN_ID_PATTERN.test(runId) || getRun(state, runId)) return state
  return trim({ order: [...state.order, runId], runs: { ...state.runs, [runId]: newRun(runId) } })
}

function trim(state: RunLogState): RunLogState {
  if (state.order.length <= MAX_RUNS) return state
  // 끝난 실행 중 가장 오래된 것부터 버린다. 진행 중인 실행은 지키되, 전부 진행 중이면 가장 오래된 것을 버린다.
  const drop = state.order.find((id) => getRun(state, id)?.finished) ?? state.order[0]
  const runs = { ...state.runs }
  delete runs[drop]
  return trim({ order: state.order.filter((id) => id !== drop), runs })
}

export function applyEvent(state: RunLogState, raw: unknown): RunLogState {
  const ev = classifyEvent(raw)
  if (!ev) return state
  const base = getRun(state, ev.runId)
  // 종료 뒤에 늦게 도착한 이벤트는 순서가 어긋난 것이므로 버린다.
  if (base?.finished) return state
  const run: RunLog = base ? { ...base } : newRun(ev.runId)

  if (ev.toolKey !== null && run.seenTools.includes(ev.toolKey)) return state
  if (ev.toolKey !== null)
    run.seenTools = [...run.seenTools, ev.toolKey].slice(-MAX_ENTRIES_PER_RUN)

  if (run.status === 'pending') run.status = 'running'

  if (ev.entry) {
    const entries = [...run.entries, { ...ev.entry, seq: run.nextSeq }]
    run.nextSeq += 1
    if (entries.length > MAX_ENTRIES_PER_RUN) {
      const over = entries.length - MAX_ENTRIES_PER_RUN
      run.dropped += over
      entries.splice(0, over)
    }
    run.entries = entries
  }

  if (ev.type === 'error' && ev.data.code === 'cancelled') run.sawCancel = true
  if (ev.type === 'result') {
    run.usage = {
      costUsd: numOrNull(ev.data.costUsd),
      durationMs: numOrNull(ev.data.durationMs),
      numTurns: numOrNull(ev.data.numTurns)
    }
  }
  run.status = nextStatus(run, ev)
  if (ev.type === 'exit') run.finished = true

  const exists = base !== null
  return trim({
    order: exists ? state.order : [...state.order, ev.runId],
    runs: { ...state.runs, [ev.runId]: run }
  })
}

/** 취소는 다른 결과보다 우선하고, 오류는 완료보다 우선한다. exit 전에는 종료로 보지 않는 오류도 있다. */
function nextStatus(run: RunLog, ev: ClassifiedEvent): RunStatus {
  if (run.sawCancel) return 'cancelled'
  if (ev.type === 'error') return 'error'
  if (ev.type === 'result') return ev.data.success === true ? 'done' : 'error'
  if (ev.type === 'exit') {
    if (run.status === 'error' || run.status === 'done') return run.status
    return ev.data.exitCode === 0 ? 'done' : 'error'
  }
  return run.status === 'pending' ? 'running' : run.status
}

export function applyEvents(state: RunLogState, events: readonly unknown[]): RunLogState {
  return events.reduce<RunLogState>(applyEvent, state)
}

export { getRun }

export function isActive(status: RunStatus): boolean {
  return status === 'pending' || status === 'running'
}

/**
 * 화면에 그릴 구간. 기본은 최근 visible건이다.
 * pinnedSeq(자동 스크롤을 끈 시점에 보던 첫 항목)가 있으면 그 항목부터 보여, 새 이벤트가 와도 읽던 항목이 밀려나지 않는다.
 */
export function windowEntries(
  run: RunLog,
  pinnedSeq: number | null = null
): { shown: LogEntry[]; hidden: number } {
  const len = run.entries.length
  let start = Math.max(0, len - run.visible)
  if (pinnedSeq !== null) {
    const idx = run.entries.findIndex((e) => e.seq >= pinnedSeq)
    start = Math.max(0, Math.min(start, idx === -1 ? len : idx))
  }
  return { shown: start > 0 ? run.entries.slice(start) : run.entries, hidden: start }
}

export function showEarlier(state: RunLogState, runId: string): RunLogState {
  const run = getRun(state, runId)
  if (!run) return state
  return {
    ...state,
    runs: { ...state.runs, [runId]: { ...run, visible: run.visible + WINDOW_STEP } }
  }
}

export function usageText(u: UsageSummary | null): string | null {
  if (!u) return null
  const parts: string[] = []
  if (u.costUsd !== null) parts.push(`비용 $${u.costUsd.toFixed(4)}`)
  if (u.durationMs !== null) parts.push(`${(u.durationMs / 1000).toFixed(1)}초`)
  if (u.numTurns !== null) parts.push(`${u.numTurns}턴`)
  return parts.length > 0 ? parts.join(' · ') : null
}

/** 사용자가 바닥에서 충분히 멀어지도록 위로 올렸는지. */
export function scrolledAwayFromBottom(
  m: { scrollTop: number; clientHeight: number; scrollHeight: number },
  threshold: number = AUTOSCROLL_THRESHOLD_PX
): boolean {
  return m.scrollHeight - m.scrollTop - m.clientHeight > threshold
}

export function runLabel(order: readonly string[], runId: string): string {
  const n = order.indexOf(runId) + 1
  return `실행 ${n > 0 ? n : '?'}`
}

/** 이벤트를 모았다가 한 프레임에 한 번만 반영한다 (스트림이 빨라도 렌더가 몰리지 않게). */
export function createBatcher<T>(
  apply: (batch: T[]) => void,
  schedule: (cb: () => void) => number,
  cancel: (id: number) => void
): { push: (item: T) => void; dispose: () => void } {
  let queue: T[] = []
  let handle: number | null = null
  let disposed = false
  return {
    push: (item) => {
      if (disposed) return
      queue.push(item)
      if (handle === null) {
        handle = schedule(() => {
          handle = null
          const batch = queue
          queue = []
          if (!disposed && batch.length > 0) apply(batch)
        })
      }
    },
    dispose: () => {
      disposed = true
      queue = []
      if (handle !== null) cancel(handle)
      handle = null
    }
  }
}
