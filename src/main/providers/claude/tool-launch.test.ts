import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { ClaudeAdapter, toolArgs } from './claude-adapter'
import { buildCliEnv } from '../cli-env'
import type { SpawnFn } from '../cli-runner'
import type { RunToolOptions } from '../types'

class FakeChild extends EventEmitter {
  stdout = new PassThrough()
  stderr = new PassThrough()
  kill(): boolean {
    queueMicrotask(() => this.emit('close', null, 'SIGTERM'))
    return true
  }
}

const tools: RunToolOptions = {
  allowedTools: ['gate_push', 'gate_merge'],
  toolConfigPath: '/tmp/mc-gate-x/tools.json',
  settingsPath: '/tmp/mc-gate-x/settings.json'
}

describe('tool launch options', () => {
  it('builds typed allowedTools and config args before --', () => {
    const args = toolArgs(tools)
    expect(args).toContain('--strict-mcp-config')
    expect(args[args.indexOf('--allowedTools') + 1]).toBe(
      'mcp__gate__gate_push,mcp__gate__gate_merge'
    )
  })

  it('rejects relative or option-like paths and unknown tools', () => {
    expect(() => toolArgs({ ...tools, toolConfigPath: '--evil' })).toThrow()
    expect(() => toolArgs({ ...tools, settingsPath: 'rel/path.json' })).toThrow()
    expect(() => toolArgs({ ...tools, allowedTools: ['Bash' as unknown as 'gate_push'] })).toThrow()
    expect(() => toolArgs({ ...tools, allowedTools: [] })).toThrow()
  })

  it('passes only allowlisted env and runs onFinish once, even on spawn failure', async () => {
    vi.stubEnv('GITHUB_TOKEN', 'dummy-value')
    vi.stubEnv('PATH', '/usr/bin')
    const seen: { env?: NodeJS.ProcessEnv }[] = []
    const child = new FakeChild()
    const spawnFn: SpawnFn = (_c, _a, o) => {
      seen.push(o)
      return child as unknown as ChildProcess
    }
    const onFinish = vi.fn()
    const adapter = new ClaudeAdapter({ cwd: '/work', spawnFn })
    expect(adapter.start({ prompt: 'hi' }, () => undefined, { tools, onFinish }).ok).toBe(true)
    expect(seen[0].env?.GITHUB_TOKEN).toBeUndefined()
    expect(seen[0].env?.PATH).toBe('/usr/bin')
    child.emit('close', 0, null)
    await Promise.resolve()
    await Promise.resolve()
    expect(onFinish).toHaveBeenCalledTimes(1)

    const failing = new ClaudeAdapter({
      cwd: '/work',
      spawnFn: () => {
        throw new Error('boom')
      }
    })
    const onFinish2 = vi.fn()
    expect(failing.start({ prompt: 'hi' }, () => undefined, { onFinish: onFinish2 }).ok).toBe(false)
    expect(failing.start({ prompt: '' }, () => undefined, { onFinish: onFinish2 }).ok).toBe(false)
    await Promise.resolve()
    await Promise.resolve()
    expect(onFinish2).toHaveBeenCalledTimes(2)
    vi.unstubAllEnvs()
  })

  it('buildCliEnv drops credentials-like variables', () => {
    const env = buildCliEnv({
      PATH: '/bin',
      AWS_SECRET_ACCESS_KEY: 'x',
      GH_TOKEN: 'y',
      LC_ALL: 'C'
    })
    expect(Object.keys(env).sort()).toEqual(['LC_ALL', 'PATH'])
  })
})
