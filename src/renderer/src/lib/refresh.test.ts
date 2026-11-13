import { describe, expect, it } from 'vitest'
import {
  createRefreshGuard,
  FOCUS_MIN_GAP_MS,
  runExclusive,
  shouldRefetchOnFocus,
  unreadableReasonTextFor,
  unreadableTexts
} from './refresh'

describe('refresh helpers', () => {
  it('drops responses that started before an invalidation', () => {
    const g = createRefreshGuard()
    const t = g.begin()
    expect(g.isCurrent(t)).toBe(true)
    g.invalidate()
    expect(g.isCurrent(t)).toBe(false)
    expect(g.isCurrent(g.begin())).toBe(true)
  })
  it('runs exclusively and releases the lock on failure', async () => {
    const lock = { current: false }
    let release: () => void = () => {}
    const first = runExclusive(lock, () => new Promise<void>((r) => (release = r)))
    expect(await runExclusive(lock, async () => 1)).toEqual({ ran: false })
    release()
    expect(await first).toEqual({ ran: true, value: undefined })
    await expect(
      runExclusive(lock, async () => {
        throw new Error('x')
      })
    ).rejects.toThrow()
    expect(lock.current).toBe(false)
  })
  it('throttles focus refetch', () => {
    expect(shouldRefetchOnFocus(null, 0)).toBe(true)
    expect(shouldRefetchOnFocus(1000, 1000 + FOCUS_MIN_GAP_MS - 1)).toBe(false)
    expect(shouldRefetchOnFocus(1000, 1000 + FOCUS_MIN_GAP_MS)).toBe(true)
  })
  it('falls back to the generic unreadable text', () => {
    const t = unreadableTexts('티켓이')
    expect(unreadableReasonTextFor(t, 'duplicate')).toContain('티켓이')
    expect(unreadableReasonTextFor(t, 'toString')).toBe(t.unreadable)
    expect(unreadableReasonTextFor(t, 42)).toBe(t.unreadable)
  })
})
