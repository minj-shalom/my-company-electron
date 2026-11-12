import { describe, expect, it } from 'vitest'
import type { OfficeStatusMap } from '../../../shared/office'
import { MOCK_TICK_MS, mockOfficeStatus, mockStatusAt } from './mock-status'
import { countByStatus, isAnimated, sameStatuses, statusOf } from './status'
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
