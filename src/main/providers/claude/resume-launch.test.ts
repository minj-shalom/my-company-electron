import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { ClaudeAdapter } from './claude-adapter'
import type { SpawnFn } from '../cli-runner'

function capture(): { spawnFn: SpawnFn; calls: string[][] } {
  const calls: string[][] = []
  const spawnFn: SpawnFn = (_c, args) => {
    calls.push(args)
    const child = new EventEmitter() as ReturnType<SpawnFn>
    ;(child as unknown as { stdout: null; stderr: null }).stdout = null
    ;(child as unknown as { stdout: null; stderr: null }).stderr = null
    ;(child as unknown as { kill: () => boolean }).kill = () => true
    return child
  }
  return { spawnFn, calls }
}

describe('claude session resume', () => {
  it('passes --resume before the prompt separator', () => {
    const { spawnFn, calls } = capture()
    const r = new ClaudeAdapter({ cwd: '/w', spawnFn }).start({ prompt: 'hi' }, () => undefined, {
      resumeSessionId: 'abcd1234-ef56'
    })
    expect(r.ok).toBe(true)
    const args = calls[0]
    expect(args[args.indexOf('--resume') + 1]).toBe('abcd1234-ef56')
    expect(args.indexOf('--resume')).toBeLessThan(args.indexOf('--'))
  })

  it('refuses option-like or malformed session ids without spawning', () => {
    const { spawnFn, calls } = capture()
    const a = new ClaudeAdapter({ cwd: '/w', spawnFn })
    for (const id of ['--evil-flag-x', 'a b c d e f g h', 'short', 'x/../../y1234567'])
      expect(a.start({ prompt: 'hi' }, () => undefined, { resumeSessionId: id }).ok).toBe(false)
    expect(calls).toHaveLength(0)
  })
})
