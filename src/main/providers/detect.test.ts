import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { detectAllProviders, detectProvider } from './detect'
import type { ExecEnv } from './executable'
import type { SpawnFn } from './cli-runner'

class FakeChild extends EventEmitter {
  stdout = new PassThrough()
  kill = vi.fn(() => true)
}

function setup(
  platform: NodeJS.Platform,
  env: Record<string, string>,
  files: string[],
  child = new FakeChild()
): {
  execEnv: ExecEnv
  spawnFn: SpawnFn
  calls: Array<[string, string[], Record<string, unknown>]>
  child: FakeChild
} {
  const calls: Array<[string, string[], Record<string, unknown>]> = []
  const set = new Set(files)
  return {
    execEnv: { platform, env, isExecutable: (f) => set.has(f), homeDir: '/Users/u' },
    spawnFn: ((c: string, a: string[], o: Record<string, unknown>) => {
      calls.push([c, a, o])
      return child as unknown as ChildProcess
    }) as SpawnFn,
    calls,
    child
  }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('detectProvider states', () => {
  it('ok: returns the version and spawns without a shell', async () => {
    const s = setup('darwin', { PATH: '/usr/bin' }, ['/usr/bin/claude'])
    const p = detectProvider('claude', s)
    s.child.stdout.write('2.1.0 (Claude Code)\n')
    await vi.advanceTimersByTimeAsync(0)
    s.child.emit('close', 0, null)
    expect(await p).toMatchObject({
      provider: 'claude',
      state: 'ok',
      version: '2.1.0 (Claude Code)'
    })
    expect(s.calls[0]?.[0]).toBe('/usr/bin/claude')
    expect(s.calls[0]?.[1]).toEqual(['--version'])
    expect(s.calls[0]?.[2]).toMatchObject({ shell: false })
  })

  it('not-installed: nothing on PATH, and spawn is never called', async () => {
    const s = setup('darwin', { PATH: '/usr/bin' }, [])
    expect((await detectProvider('codex', s)).state).toBe('not-installed')
    expect(s.calls).toHaveLength(0)
  })

  it('not-installed: ENOENT race after resolve', async () => {
    const s = setup('darwin', { PATH: '/usr/bin' }, ['/usr/bin/claude'])
    const p = detectProvider('claude', s)
    s.child.emit(
      'error',
      Object.assign(new Error('spawn /usr/bin/claude ENOENT'), { code: 'ENOENT' })
    )
    expect((await p).state).toBe('not-installed')
  })

  it('exec-failed: EACCES, nonzero exit, and unsafe .cmd path', async () => {
    const s = setup('darwin', { PATH: '/usr/bin' }, ['/usr/bin/claude'])
    const p = detectProvider('claude', s)
    s.child.emit('error', Object.assign(new Error('x'), { code: 'EACCES' }))
    expect((await p).state).toBe('exec-failed')

    const s2 = setup('darwin', { PATH: '/usr/bin' }, ['/usr/bin/claude'])
    const p2 = detectProvider('claude', s2)
    s2.child.emit('close', 1, null)
    expect((await p2).state).toBe('exec-failed')

    const s3 = setup('win32', { PATH: 'C:\\a&b' }, ['C:\\a&b\\claude.cmd'])
    expect((await detectProvider('claude', s3)).state).toBe('exec-failed')
    expect(s3.calls).toHaveLength(0)
  })

  it('exec-failed when spawn throws synchronously', async () => {
    const s = setup('darwin', { PATH: '/usr/bin' }, ['/usr/bin/claude'])
    const spawnFn: SpawnFn = () => {
      throw Object.assign(new Error('boom /secret/path'), { code: 'EINVAL' })
    }
    expect((await detectProvider('claude', { ...s, spawnFn })).state).toBe('exec-failed')
  })

  it('timeout: kills the child, clears the timer, honors timeoutMs', async () => {
    const s = setup('darwin', { PATH: '/usr/bin' }, ['/usr/bin/gemini'])
    const p = detectProvider('gemini', { ...s, timeoutMs: 1500 })
    await vi.advanceTimersByTimeAsync(1499)
    expect(s.child.kill).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect((await p).state).toBe('timeout')
    expect(s.child.kill).toHaveBeenCalledWith('SIGKILL')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('messages never contain paths or raw error text', async () => {
    const s = setup('win32', { PATH: 'C:\\Users\\secret' }, ['C:\\Users\\secret\\claude.exe'])
    const p = detectProvider('claude', s)
    s.child.emit(
      'error',
      Object.assign(new Error('spawn C:\\Users\\secret\\claude.exe EACCES'), { code: 'EACCES' })
    )
    const r = await p
    expect(JSON.stringify(r)).not.toMatch(/secret|EACCES|\\\\|C:/)
  })
})

describe('detectProvider on win32', () => {
  const env = { Path: 'C:\\Users\\u\\AppData\\Roaming\\npm', PATHEXT: '.EXE;.CMD' }

  it('runs .cmd through cmd.exe with verbatim fixed arguments', async () => {
    const s = setup('win32', { ...env, SystemRoot: 'C:\\Windows' }, [
      'C:\\Users\\u\\AppData\\Roaming\\npm\\claude.cmd'
    ])
    const p = detectProvider('claude', s)
    s.child.stdout.write('1.0.0\r\n')
    await vi.advanceTimersByTimeAsync(0)
    s.child.emit('close', 0, null)
    expect((await p).version).toBe('1.0.0')
    const [file, args, opts] = s.calls[0] as [string, string[], Record<string, unknown>]
    expect(file).toBe('C:\\Windows\\System32\\cmd.exe')
    expect(args).toEqual([
      '/d',
      '/s',
      '/c',
      '""C:\\Users\\u\\AppData\\Roaming\\npm\\claude.cmd" --version"'
    ])
    expect(opts).toMatchObject({ shell: false, windowsVerbatimArguments: true })
  })

  it('runs .exe directly', async () => {
    const s = setup('win32', env, ['C:\\Users\\u\\AppData\\Roaming\\npm\\codex.exe'])
    const p = detectProvider('codex', s)
    s.child.emit('close', 0, null)
    await p
    expect(s.calls[0]?.slice(0, 2)).toEqual([
      'C:\\Users\\u\\AppData\\Roaming\\npm\\codex.exe',
      ['--version']
    ])
  })
})

describe('detectAllProviders', () => {
  it('covers exactly the fixed allow list', async () => {
    const s = setup('darwin', { PATH: '/x' }, [])
    const r = await detectAllProviders(s)
    expect(r.map((d) => d.provider)).toEqual(['claude', 'codex', 'gemini'])
  })

  it('rejects names outside the allow list without spawning', async () => {
    const s = setup('darwin', { PATH: '/x' }, ['/x/rm'])
    expect((await detectProvider('rm' as never, s)).state).toBe('not-installed')
    expect(s.calls).toHaveLength(0)
  })
})

describe('no automatic usage', () => {
  it('automatic-path modules never import the connection test', () => {
    for (const f of [
      'detect.ts',
      'version-probe.ts',
      'executable.ts',
      'claude/claude-adapter.ts'
    ]) {
      const src = readFileSync(new URL(f, import.meta.url), 'utf8')
      expect(src, f).not.toMatch(/connection-test|runConnectionTest/)
    }
  })

  it('detection only ever passes --version', async () => {
    const s = setup('darwin', { PATH: '/x' }, ['/x/claude', '/x/codex', '/x/gemini'])
    const p = detectAllProviders(s)
    s.child.emit('close', 0, null)
    await p
    expect(s.calls.length).toBe(3)
    for (const c of s.calls) expect(c[1]).toEqual(['--version'])
  })
})
