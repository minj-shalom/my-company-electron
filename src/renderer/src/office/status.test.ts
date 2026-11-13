import { describe, expect, it } from 'vitest'
import type { OfficeStatusMap } from '../../../shared/office'
import { MOCK_TICK_MS, mockOfficeStatus, mockStatusAt } from './mock-status'
import {
  DEBOUNCE_MS,
  REFRESH_MS,
  countByStatus,
  createLiveStatusSource,
  deriveStatuses,
  isAnimated,
  sameStatuses,
  statusOf
} from './status'
import { vi } from 'vitest'

describe('status helpers', () => {
  const map: OfficeStatusMap = { a: 'working', b: 'awaiting-approval' }
  it('defaults unknown or prototype keys to idle', () => {
    expect(statusOf(map, 'zzz')).toBe('idle')
    expect(statusOf(map, 'constructor')).toBe('idle')
    expect(statusOf(map, 'a')).toBe('working')
  })
  it('counts by status', () => {
    expect(countByStatus(['a', 'b', 'c'], map)).toEqual({
      idle: 1,
      working: 1,
      'awaiting-approval': 1
    })
  })
  it('animates only non-idle states', () => {
    expect(isAnimated('idle')).toBe(false)
    expect(isAnimated('working')).toBe(true)
    expect(isAnimated('awaiting-approval')).toBe(true)
  })
  it('compares only the listed titles, treating missing as idle', () => {
    expect(sameStatuses(['a'], { a: 'idle' }, {})).toBe(true)
    expect(sameStatuses(['a'], { a: 'working' }, {})).toBe(false)
  })
})

describe('mock status provider', () => {
  it('cycles through all three states across employees', () => {
    const seen = new Set(Array.from({ length: 20 }, (_, i) => mockStatusAt(i, 0)))
    expect(seen).toEqual(new Set(['idle', 'working', 'awaiting-approval']))
  })
  it('changes over time for one employee', () => {
    const seen = new Set(Array.from({ length: 60 }, (_, t) => mockStatusAt(0, t)))
    expect(seen.size).toBe(3)
  })
  it('emits an initial snapshot, only emits on change, and stops after unsubscribe', () => {
    vi.useFakeTimers()
    try {
      const calls: OfficeStatusMap[] = []
      const off = mockOfficeStatus.subscribe(['a', 'b'], (s) => calls.push(s))
      expect(calls).toHaveLength(1)
      vi.advanceTimersByTime(MOCK_TICK_MS) // tick 1: 3틱 단위라 변화 없음
      expect(calls).toHaveLength(1)
      vi.advanceTimersByTime(MOCK_TICK_MS * 2) // tick 3: 단계가 바뀐다
      expect(calls).toHaveLength(2)
      off()
      vi.advanceTimersByTime(MOCK_TICK_MS * 30)
      expect(calls).toHaveLength(2)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('deriveStatuses', () => {
  const ids = { CTO: 'cto', PM: 'pm', 인턴: null, COO: null }
  const titles = ['CTO', 'PM', '인턴', 'COO']
  it('marks in-progress assignees as working', () => {
    const r = deriveStatuses(
      titles,
      ids,
      [{ id: 'T-1', status: 'in-progress', assignee: 'cto' }],
      []
    )
    expect(r).toEqual({ CTO: 'working', PM: 'idle', 인턴: 'idle', COO: 'idle' })
  })
  it('prefers awaiting-approval and ignores backlog, done and unassigned tickets', () => {
    const r = deriveStatuses(
      titles,
      ids,
      [
        { id: 'T-1', status: 'in-progress', assignee: 'cto' },
        { id: 'T-2', status: 'backlog', assignee: 'pm' },
        { id: 'T-3', status: 'in-progress', assignee: null }
      ],
      [{ ticketId: 'T-1' }, { ticketId: null }]
    )
    expect(r.CTO).toBe('awaiting-approval')
    expect(r.PM).toBe('idle')
  })
})

describe('live source', () => {
  const ok = <T>(value: T): { ok: true; value: T } => ({ ok: true, value })
  const tickets = (items: object[]): never => ok({ items, unreadable: [] }) as never
  function setup(
    items: object[],
    decisions: object[] = []
  ): {
    api: Parameters<typeof createLiveStatusSource>[0] extends () => infer A ? A : never
    emit: (e: { type: string; runId: string }) => void
    unsub: ReturnType<typeof vi.fn>
  } {
    let listener: ((e: never) => void) | null = null
    const unsub = vi.fn()
    const api = {
      listTickets: vi.fn(async () => tickets(items)),
      listDecisions: vi.fn(async () => ok({ items: decisions, unreadable: [] }) as never),
      onRunEvent: vi.fn((l: (e: never) => void) => {
        listener = l
        return unsub
      })
    }
    return { api: api as never, emit: (e) => listener?.(e as never), unsub }
  }

  it('sends the current state, reloads on run events and stops after unsubscribe', async () => {
    vi.useFakeTimers()
    try {
      const items = [{ id: 'T-1', status: 'in-progress', assignee: 'cto' }]
      const { api, emit, unsub } = setup(items)
      const calls: OfficeStatusMap[] = []
      const stop = createLiveStatusSource(() => api).subscribe(['CTO'], (m) => calls.push(m), {
        CTO: 'cto'
      })
      await vi.advanceTimersByTimeAsync(0)
      expect(calls).toEqual([{ CTO: 'working' }])
      items[0].status = 'done'
      emit({ type: 'exit', runId: 'r' })
      emit({ type: 'log', runId: 'r' })
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10)
      expect(calls.at(-1)).toEqual({ CTO: 'idle' })
      expect(calls).toHaveLength(2)
      stop()
      expect(unsub).toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(REFRESH_MS * 2)
      expect(calls).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the previous state when reading fails', async () => {
    const { api } = setup([])
    api.listTickets = vi.fn(async () => {
      throw new Error('x')
    }) as never
    const onChange = vi.fn()
    const stop = createLiveStatusSource(() => api).subscribe(['CTO'], onChange, { CTO: 'cto' })
    await Promise.resolve()
    await Promise.resolve()
    expect(onChange).not.toHaveBeenCalled()
    stop()
  })
})
