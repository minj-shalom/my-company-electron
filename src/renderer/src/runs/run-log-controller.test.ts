import { describe, expect, it, vi } from 'vitest'
import {
  CANCEL_FAILED_TEXT,
  CANCEL_GONE_TEXT,
  canCancel,
  requestCancel,
  startSubscription,
  type Subscription
} from './run-log-controller'

describe('canCancel', () => {
  it.each([
    ['pending', false, true],
    ['running', false, true],
    ['running', true, false],
    ['done', false, false],
    ['error', false, false],
    ['cancelled', false, false]
  ] as const)('%s cancelling=%s -> %s', (status, busy, want) => {
    expect(canCancel(status, busy)).toBe(want)
  })
})

describe('requestCancel', () => {
  it('maps true, false and exceptions to outcomes and always clears busy', async () => {
    const busy = vi.fn()
    const lock = { current: false }
    expect(await requestCancel(lock, async () => true, 'r', busy)).toEqual({
      kind: 'cancelled',
      note: null
    })
    expect(await requestCancel(lock, async () => false, 'r', busy)).toEqual({
      kind: 'gone',
      note: CANCEL_GONE_TEXT
    })
    const failed = await requestCancel(
      lock,
      () => Promise.reject(new Error('/secret/path')),
      'r',
      busy
    )
    expect(failed).toEqual({ kind: 'failed', note: CANCEL_FAILED_TEXT })
    expect(JSON.stringify(failed)).not.toContain('secret')
    expect(busy.mock.calls.map((c) => c[0])).toEqual([true, false, true, false, true, false])
    expect(lock.current).toBe(false)
  })
  it('ignores a second click while the first is pending', async () => {
    const lock = { current: false }
    let release: (v: boolean) => void = () => {}
    const cancel = vi.fn(() => new Promise<boolean>((r) => (release = r)))
    const first = requestCancel(lock, cancel, 'r', () => {})
    const second = await requestCancel(lock, cancel, 'r', () => {})
    expect(second).toEqual({ kind: 'skipped' })
    release(true)
    expect((await first).kind).toBe('cancelled')
    expect(cancel).toHaveBeenCalledTimes(1)
  })
})

describe('startSubscription lifecycle', () => {
  const setup = (): {
    listeners: Set<(e: unknown) => void>
    frames: (() => void)[]
    onBatch: ReturnType<typeof vi.fn>
    start: () => Subscription
  } => {
    const listeners = new Set<(e: unknown) => void>()
    const frames: (() => void)[] = []
    const onBatch = vi.fn()
    const subscribe = (l: (e: unknown) => void): (() => void) => {
      listeners.add(l)
      return () => listeners.delete(l)
    }
    const start = (): Subscription =>
      startSubscription(subscribe, onBatch, (cb) => frames.push(cb), vi.fn())
    return { listeners, frames, onBatch, start }
  }
  it('batches per frame, unsubscribes on dispose, and resubscribes cleanly', () => {
    const { listeners, frames, onBatch, start } = setup()
    const a = start()
    ;[...listeners][0]('e1')
    ;[...listeners][0]('e2')
    frames[0]()
    expect(onBatch).toHaveBeenCalledWith(['e1', 'e2'])
    a.dispose()
    expect(listeners.size).toBe(0)
    const b = start()
    expect(listeners.size).toBe(1)
    b.dispose()
    expect(listeners.size).toBe(0)
  })
  it('never calls back after dispose, even for queued frames or late events', () => {
    const { listeners, frames, onBatch, start } = setup()
    const sub = start()
    const listener = [...listeners][0]
    listener('queued')
    sub.dispose()
    frames[0]?.()
    listener('late')
    expect(frames).toHaveLength(1)
    expect(onBatch).not.toHaveBeenCalled()
  })
  it('reports a throwing subscribe as failed and disposes safely', () => {
    const sub = startSubscription(
      () => {
        throw new Error('no api')
      },
      vi.fn(),
      () => 1,
      vi.fn()
    )
    expect(sub.failed).toBe(true)
    expect(() => sub.dispose()).not.toThrow()
  })
})
