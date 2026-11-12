import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runConnectionTest } from './connection-test'
import type { SpawnFn } from './cli-runner'
import type { ExecEnv } from './executable'

class FakeChild extends EventEmitter {
  stdout = new PassThrough()
  kill = vi.fn(() => true)
}

function setup(
  platform: NodeJS.Platform,
  env: Record<string, string>,
  files: string[]
): {
  child: FakeChild
  calls: Array<[string, string[], Record<string, unknown>]>
  execEnv: ExecEnv
  spawnFn: SpawnFn
} {
  const child = new FakeChild()
  const calls: Array<[string, string[], Record<string, unknown>]> = []
  const set = new Set(files)
  return {
    child,
    calls,
    execEnv: { platform, env, isExecutable: (f: string) => set.has(f), homeDir: '/Users/u' },
    spawnFn: ((c: string, a: string[], o: Record<string, unknown>) => {
      calls.push([c, a, o])
      return child as unknown as ChildProcess
    }) as SpawnFn
  }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('runConnectionTest', () => {
  it('ok when the CLI answers with exit 0, using fixed args and no shell', async () => {
    const s = setup('darwin', { PATH: '/x' }, ['/x/claude'])
    const p = runConnectionTest('claude', s)
    s.child.stdout.write('pong')
    await vi.advanceTimersByTimeAsync(0)
    s.child.emit('close', 0, null)
    const r = await p
    expect(r.state).toBe('ok')
    expect(JSON.stringify(r)).not.toContain('pong')
    expect(s.calls[0]?.[1]).toEqual(['-p', '--output-format', 'text', '--', 'ping'])
    expect(s.calls[0]?.[2]).toMatchObject({ shell: false })
  })

  it('failed on nonzero exit or empty output', async () => {
    const s = setup('darwin', { PATH: '/x' }, ['/x/claude'])
    const p = runConnectionTest('claude', s)
    s.child.emit('close', 1, null)
    expect((await p).state).toBe('failed')
    const s2 = setup('darwin', { PATH: '/x' }, ['/x/claude'])
    const p2 = runConnectionTest('claude', s2)
    s2.child.emit('close', 0, null)
    expect((await p2).state).toBe('failed')
  })

  it('timeout kills the child and clears timers', async () => {
    const s = setup('darwin', { PATH: '/x' }, ['/x/claude'])
    const p = runConnectionTest('claude', { ...s, timeoutMs: 2000 })
    await vi.advanceTimersByTimeAsync(2000)
    expect((await p).state).toBe('timeout')
    expect(s.child.kill).toHaveBeenCalledWith('SIGKILL')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('not-installed without spawning; unsupported providers do not spawn', async () => {
    const s = setup('darwin', { PATH: '/x' }, ['/x/codex'])
    expect((await runConnectionTest('claude', s)).state).toBe('not-installed')
    expect((await runConnectionTest('codex', s)).state).toBe('unsupported')
    expect((await runConnectionTest('rm' as never, s)).state).toBe('unsupported')
    expect(s.calls).toHaveLength(0)
  })

  it('goes through cmd.exe on Windows .cmd with the fixed one-word prompt', async () => {
    const s = setup('win32', { PATH: 'C:\\n', SystemRoot: 'C:\\Windows' }, ['C:\\n\\claude.cmd'])
    const p = runConnectionTest('claude', s)
    s.child.emit('error', Object.assign(new Error('x'), { code: 'EACCES' }))
    expect((await p).state).toBe('exec-failed')
    expect(s.calls[0]?.[0]).toBe('C:\\Windows\\System32\\cmd.exe')
    expect(s.calls[0]?.[1]).toEqual([
      '/d',
      '/s',
      '/c',
      '""C:\\n\\claude.cmd" -p --output-format text -- ping"'
    ])
  })

  it('source does not touch the filesystem, auth paths or env contents', () => {
    const raw = readFileSync(new URL('connection-test.ts', import.meta.url), 'utf8')
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(code).not.toMatch(/node:fs|readFile|\.claude|\.ssh|credentials|process\.env/)
  })
})
