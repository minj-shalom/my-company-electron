import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClaudeAdapter } from './claude-adapter'
import type { SpawnFn } from '../cli-runner'
import type { ProviderUsage } from '../types'

class FakeChild extends EventEmitter {
  stdout = new PassThrough()
  stderr = new PassThrough()
  kill = vi.fn(() => true)
}

function adapterWith(
  child: FakeChild,
  extra: { onUsage?: (id: string, u: ProviderUsage) => void } = {}
): { adapter: ClaudeAdapter; calls: unknown[][] } {
  const calls: unknown[][] = []
  const spawnFn: SpawnFn = (...a) => {
    calls.push(a)
    return child as unknown as ChildProcess
  }
  return { adapter: new ClaudeAdapter({ cwd: '/work', spawnFn, ...extra }), calls }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('ClaudeAdapter.checkInstall', () => {
  it('returns the first line of --version output', async () => {
    const child = new FakeChild()
    const { adapter, calls } = adapterWith(child)
    const p = adapter.checkInstall()
    child.stdout.write('2.1.0 (Claude Code)\nextra\n')
    await vi.advanceTimersByTimeAsync(0)
    child.emit('close', 0, null)
    expect(await p).toEqual({ installed: true, version: '2.1.0 (Claude Code)' })
    const [cmd, args, opts] = calls[0] as [string, string[], { shell: boolean }]
    expect([cmd, args, opts.shell]).toEqual(['claude', ['--version'], false])
  })

  it('reports not installed on ENOENT', async () => {
    const child = new FakeChild()
    const { adapter } = adapterWith(child)
    const p = adapter.checkInstall()
    child.emit('error', Object.assign(new Error('x'), { code: 'ENOENT' }))
    expect(await p).toEqual({ installed: false, version: null })
  })

  it('reports not installed on nonzero exit', async () => {
    const child = new FakeChild()
    const { adapter } = adapterWith(child)
    const p = adapter.checkInstall()
    child.emit('close', 1, null)
    expect(await p).toEqual({ installed: false, version: null })
  })

  it('kills a hanging probe and clears its timer', async () => {
    const child = new FakeChild()
    const { adapter } = adapterWith(child)
    const p = adapter.checkInstall()
    await vi.advanceTimersByTimeAsync(5000)
    expect(await p).toEqual({ installed: false, version: null })
    expect(child.kill).toHaveBeenCalledWith('SIGKILL')
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('ClaudeAdapter usage and agents', () => {
  it('reports usage through onUsage when a result line arrives', () => {
    const child = new FakeChild()
    const seen: Array<[string, ProviderUsage]> = []
    const { adapter } = adapterWith(child, { onUsage: (id, u) => seen.push([id, u]) })
    const r = adapter.start({ prompt: 'hi' }, () => {})
    if (!r.ok) throw new Error('unreachable')
    child.stdout.write('{"type":"result","subtype":"success","total_cost_usd":0.1}\n')
    child.emit('close', 0, null)
    expect(seen).toHaveLength(1)
    expect(seen[0]?.[0]).toBe(r.runId)
    expect(seen[0]?.[1].costUsd).toBe(0.1)
  })

  it('needs no translated files for claude (uses .claude/agents as is)', () => {
    const { adapter } = adapterWith(new FakeChild())
    expect(adapter.agentTranslator.translate([])).toEqual([])
    expect(adapter.id).toBe('claude')
  })
})
