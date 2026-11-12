import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SpawnFn } from './cli-runner'
import { probeOutcome, probeVersion } from './version-probe'

class FakeChild extends EventEmitter {
  stdout = new PassThrough()
  kill = vi.fn(() => true)
}
const spawnOf =
  (c: FakeChild): SpawnFn =>
  () =>
    c as unknown as ChildProcess

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('probeVersion contract', () => {
  it('maps ok / failures / timeout to {installed, version}', async () => {
    const a = new FakeChild()
    const p = probeVersion('x', spawnOf(a))
    a.stdout.write('1.2.3\n')
    await vi.advanceTimersByTimeAsync(0)
    a.emit('close', 0, null)
    expect(await p).toEqual({ installed: true, version: '1.2.3' })

    const b = new FakeChild()
    const q = probeVersion('x', spawnOf(b))
    b.emit('close', 2, null)
    expect(await q).toEqual({ installed: false, version: null })

    const c = new FakeChild()
    const r = probeVersion('x', spawnOf(c), 100)
    await vi.advanceTimersByTimeAsync(100)
    expect(await r).toEqual({ installed: false, version: null })
  })
})

describe('probeOutcome', () => {
  it('caps buffered stdout at 400 chars and the version at 100', async () => {
    const c = new FakeChild()
    const p = probeOutcome('x', ['--version'], spawnOf(c))
    for (let i = 0; i < 50; i++) c.stdout.write('a'.repeat(1000))
    await vi.advanceTimersByTimeAsync(0)
    c.emit('close', 0, null)
    const r = await p
    expect(r.version).toHaveLength(100)
  })

  it('uses the injected kill function on timeout', async () => {
    const c = new FakeChild()
    const killFn = vi.fn()
    const p = probeOutcome('x', [], spawnOf(c), 50, {}, killFn)
    await vi.advanceTimersByTimeAsync(50)
    expect((await p).state).toBe('timeout')
    expect(killFn).toHaveBeenCalledWith(c)
  })
})
