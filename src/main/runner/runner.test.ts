import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClaudeRunner, type SpawnFn } from './runner'
import type { RunEvent } from '../../shared/run'

class FakeChild extends EventEmitter {
  stdout = new PassThrough()
  stderr = new PassThrough()
  killed: string[] = []
  kill(sig: string): boolean {
    this.killed.push(sig)
    if (sig === 'SIGTERM') queueMicrotask(() => this.emit('close', null, 'SIGTERM'))
    return true
  }
}

function setup(): {
  child: FakeChild
  runner: ClaudeRunner
  events: RunEvent[]
  calls: unknown[][]
} {
  const child = new FakeChild()
  const calls: unknown[][] = []
  const spawnFn: SpawnFn = (...a) => {
    calls.push(a)
    return child as unknown as ChildProcess
  }
  return { child, runner: new ClaudeRunner({ cwd: '/work', spawnFn }), events: [], calls }
}

const types = (e: RunEvent[]): string[] => e.map((x) => x.type)

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('ClaudeRunner', () => {
  it('spawns with an args array, no shell, and prompt after --', () => {
    const { runner, events, calls } = setup()
    const r = runner.start({ prompt: '--evil $(rm -rf /)' }, (e) => events.push(e))
    expect(r.ok).toBe(true)
    const [cmd, args, opts] = calls[0] as [string, string[], { shell: boolean }]
    expect(cmd).toBe('claude')
    expect(args).toEqual([
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--',
      '--evil $(rm -rf /)'
    ])
    expect(opts.shell).toBe(false)
  })

  it('streams events and emits exit on success', () => {
    const { child, runner, events } = setup()
    runner.start({ prompt: 'hi' }, (e) => events.push(e))
    child.stdout.write('{"type":"system","subtype":"init","session_id":"s"}\nnot js')
    child.stdout.write('on\n{"type":"result","subtype":"success","result":"ok"}\n')
    child.emit('close', 0, null)
    expect(types(events)).toEqual(['start', 'log', 'result', 'exit'])
  })

  it('reports cli-not-found on ENOENT', () => {
    const { child, runner, events } = setup()
    runner.start({ prompt: 'hi' }, (e) => events.push(e))
    child.emit('error', Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' }))
    expect(events[0]).toMatchObject({ type: 'error', code: 'cli-not-found' })
    expect(events[1]).toMatchObject({ type: 'exit' })
    expect(JSON.stringify(events)).not.toContain('spawn claude')
  })

  it('reports spawn-failed for other errors', () => {
    const { child, runner, events } = setup()
    runner.start({ prompt: 'hi' }, (e) => events.push(e))
    child.emit('error', Object.assign(new Error('x'), { code: 'EACCES' }))
    expect(events[0]).toMatchObject({ code: 'spawn-failed' })
  })

  it('reports exit-nonzero', () => {
    const { child, runner, events } = setup()
    runner.start({ prompt: 'hi' }, (e) => events.push(e))
    child.emit('close', 2, null)
    expect(events[0]).toMatchObject({ code: 'exit-nonzero' })
  })

  it('cancels a run', async () => {
    const { child, runner, events } = setup()
    const r = runner.start({ prompt: 'hi' }, (e) => events.push(e))
    if (!r.ok) throw new Error('unreachable')
    expect(runner.cancel(r.runId)).toBe(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(child.killed).toEqual(['SIGTERM'])
    expect(events[0]).toMatchObject({ code: 'cancelled' })
    expect(runner.cancel(r.runId)).toBe(false)
  })

  it('times out and escalates to SIGKILL when SIGTERM is ignored', async () => {
    const { child, runner, events } = setup()
    child.kill = (sig: string): boolean => {
      child.killed.push(sig)
      if (sig === 'SIGKILL') child.emit('close', null, 'SIGKILL')
      return true
    }
    runner.start({ prompt: 'hi', timeoutMs: 5000 }, (e) => events.push(e))
    await vi.advanceTimersByTimeAsync(5000)
    expect(child.killed).toEqual(['SIGTERM'])
    await vi.advanceTimersByTimeAsync(3000)
    expect(child.killed).toEqual(['SIGTERM', 'SIGKILL'])
    expect(events[0]).toMatchObject({ code: 'timeout' })
  })

  it('rejects invalid requests without spawning', () => {
    const { runner, calls } = setup()
    for (const bad of [
      null,
      {},
      { prompt: '' },
      { prompt: 1 },
      { prompt: 'a', timeoutMs: 5 },
      { prompt: 'a', timeoutMs: NaN }
    ]) {
      expect(runner.start(bad, () => {})).toMatchObject({ ok: false, code: 'invalid-request' })
    }
    expect(calls).toHaveLength(0)
  })
})
