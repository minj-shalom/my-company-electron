import type { LimitedAction } from '../../shared/policy'
import type { StateStore } from './state-store'

export type KeyStatus = 'executed' | 'failed' | 'inflight'

interface KeyEntry {
  status: KeyStatus
  action: LimitedAction
  at: string
}

interface LedgerData {
  version: 1
  /** day -> `projectId|action` -> 시도 횟수. 실패한 시도도 센다 (재시도 폭주 방지). */
  counts: Record<string, Record<string, number>>
  keys: Record<string, KeyEntry>
  /** 같은 요청에 카드를 중복으로 만들지 않기 위한 카드 키 -> 카드 번호. */
  cards: Record<string, string>
}

const KEEP_DAYS = 3
const MAX_KEYS = 2000
const MAX_CARDS = 500

const empty = (): LedgerData => ({ version: 1, counts: {}, keys: {}, cards: {} })

function parse(raw: unknown): LedgerData {
  if (typeof raw !== 'object' || raw === null) return empty()
  const r = raw as Partial<LedgerData>
  if (r.version !== 1 || typeof r.counts !== 'object' || typeof r.keys !== 'object') return empty()
  return {
    version: 1,
    counts: r.counts ?? {},
    keys: r.keys ?? {},
    cards: typeof r.cards === 'object' && r.cards !== null ? r.cards : {}
  }
}

/** 회사 시간대 기준 날짜 문자열(YYYY-MM-DD). 시간대가 잘못되면 시스템 시간대를 쓴다. */
export function dayKey(now: Date, timeZone?: string): string {
  const fmt = (tz?: string): string =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(now)
  try {
    return fmt(timeZone)
  } catch {
    return fmt(undefined)
  }
}

/**
 * 일일 카운트와 멱등 키 저장. 변경은 한 줄로 세워 처리하고(경쟁 없음) 저장에 실패하면 실행하지 않는다.
 * 저장 파일을 읽지 못하면 로드를 실패시켜 상한이 초기화된 채 실행되는 일을 막는다.
 */
export class GateLedger {
  private data: LedgerData | null = null
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly store: StateStore,
    private readonly timeZone?: string
  ) {}

  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task)
    this.queue = run.catch(() => undefined)
    return run
  }

  private async load(): Promise<LedgerData> {
    if (this.data === null) this.data = parse(await this.store.load())
    return this.data
  }

  private async commit(d: LedgerData): Promise<void> {
    const days = Object.keys(d.counts).sort()
    for (const day of days.slice(0, Math.max(0, days.length - KEEP_DAYS))) delete d.counts[day]
    const keys = Object.entries(d.keys).sort((a, b) => a[1].at.localeCompare(b[1].at))
    for (const [k] of keys.slice(0, Math.max(0, keys.length - MAX_KEYS))) delete d.keys[k]
    const cards = Object.keys(d.cards)
    for (const k of cards.slice(0, Math.max(0, cards.length - MAX_CARDS))) delete d.cards[k]
    await this.store.save(d)
  }

  /** 오늘 카운트. */
  count(projectId: string, action: LimitedAction, now: Date): Promise<number> {
    return this.serial(async () => {
      const d = await this.load()
      return d.counts[dayKey(now, this.timeZone)]?.[`${projectId}|${action}`] ?? 0
    })
  }

  /** 상한 미만이면 카운트를 1 올리고 새 값을, 아니면 null을 돌려준다 (검사와 증가가 한 단계). */
  reserve(
    projectId: string,
    action: LimitedAction,
    limit: number,
    now: Date
  ): Promise<number | null> {
    return this.serial(async () => {
      const d = await this.load()
      const day = dayKey(now, this.timeZone)
      const slot = (d.counts[day] ??= {})
      const k = `${projectId}|${action}`
      const cur = slot[k] ?? 0
      if (cur >= limit) return null
      slot[k] = cur + 1
      await this.commit(d)
      return cur + 1
    })
  }

  keyStatus(key: string): Promise<KeyStatus | null> {
    return this.serial(async () => (await this.load()).keys[key]?.status ?? null)
  }

  /** 실행을 시작했다고 기록한다. 이미 키가 있으면 false (다른 호출이 처리 중이거나 처리됨). */
  begin(key: string, action: LimitedAction, now: Date): Promise<boolean> {
    return this.serial(async () => {
      const d = await this.load()
      if (d.keys[key] !== undefined) return false
      d.keys[key] = { status: 'inflight', action, at: now.toISOString() }
      await this.commit(d)
      return true
    })
  }

  /** 실행하지 않기로 한 키를 지운다 (상한·킬 스위치로 막힌 경우). 실행했다면 쓰지 않는다. */
  release(key: string): Promise<void> {
    return this.serial(async () => {
      const d = await this.load()
      if (d.keys[key]?.status === 'inflight') {
        delete d.keys[key]
        await this.commit(d)
      }
    })
  }

  settle(key: string, status: 'executed' | 'failed'): Promise<void> {
    return this.serial(async () => {
      const d = await this.load()
      const e = d.keys[key]
      if (e !== undefined) {
        e.status = status
        await this.commit(d)
      }
    })
  }

  cardFor(key: string): Promise<string | null> {
    return this.serial(async () => (await this.load()).cards[key] ?? null)
  }

  setCard(key: string, cardId: string): Promise<void> {
    return this.serial(async () => {
      const d = await this.load()
      d.cards[key] = cardId
      await this.commit(d)
    })
  }
}
