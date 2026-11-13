import { describe, expect, it } from 'vitest'
import { ClaudeAdapter, hrArgs } from './claude-adapter'
import type { SpawnFn } from '../cli-runner'

describe('hr launch options', () => {
  it('builds a fixed tool list without Bash and attaches no MCP servers', () => {
    const args = hrArgs({ settingsPath: '/tmp/mc-hr-x/settings.json' })
    expect(args[args.indexOf('--tools') + 1]).toBe('Read,Write,Edit,Grep,Glob')
    expect(args).toContain('--strict-mcp-config')
    expect(args).not.toContain('--mcp-config')
    expect(args).not.toContain('--dangerously-skip-permissions')
  })

  it('rejects relative or option-like settings paths', () => {
    expect(() => hrArgs({ settingsPath: '--evil' })).toThrow()
    expect(() => hrArgs({ settingsPath: 'rel/settings.json' })).toThrow()
    expect(() => hrArgs({ settingsPath: '/a\nb' })).toThrow()
  })

  it('refuses to combine gate tools and hr options, and still cleans up', async () => {
    let spawned = 0
    const spawnFn: SpawnFn = () => {
      spawned++
      throw new Error('should not spawn')
    }
    let finished = 0
    const r = new ClaudeAdapter({ cwd: '/work', spawnFn }).start({ prompt: 'x' }, () => undefined, {
      tools: {
        allowedTools: ['gate_push'],
        toolConfigPath: '/tmp/a.json',
        settingsPath: '/tmp/b.json'
      },
      hr: { settingsPath: '/tmp/c.json' },
      onFinish: () => void finished++
    })
    expect(r.ok).toBe(false)
    expect(spawned).toBe(0)
    await Promise.resolve()
    await Promise.resolve()
    expect(finished).toBe(1)
  })

  it('declares path-scoped writes support', () => {
    expect(new ClaudeAdapter({ cwd: '/w' }).capabilities.pathScopedWrites).toBe(true)
  })
})
