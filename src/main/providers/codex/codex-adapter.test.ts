import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import type { RunEvent, RunEventBody } from '../../../shared/run'
import type { SpawnFn } from '../cli-runner'
import { LineBuffer } from '../line-buffer'
import { codexAgentTranslator } from './agent-translator'
import { CodexAdapter } from './codex-adapter'
import { parseLine } from './parser'
import { extractCodexUsage } from './usage'

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

function setup(extra: { onUsage?: (id: string, u: unknown) => void } = {}): {
  child: FakeChild
  calls: unknown[][]
  adapter: CodexAdapter
} {
  const child = new FakeChild()
  const calls: unknown[][] = []
  const spawnFn: SpawnFn = (...a) => {
    calls.push(a)
    return child as unknown as ChildProcess
  }
  return { child, calls, adapter: new CodexAdapter({ cwd: '/work', spawnFn, ...extra }) }
}

function fixture(name: string, chunk: number): RunEventBody[] {
  const text = readFileSync(join(__dirname, '__fixtures__', name), 'utf8')
  const buf = new LineBuffer()
  const lines: string[] = []
  for (let i = 0; i < text.length; i += chunk) lines.push(...buf.push(text.slice(i, i + chunk)))
  lines.push(...buf.flush())
  return lines.flatMap(parseLine)
}

describe('codex parser', () => {
  it('parses text-only fixture', () => {
    for (const size of [1, 9, 100000]) {
      const ev = fixture('text-only.jsonl', size)
      expect(ev.map((e) => e.type)).toEqual(['start', 'message', 'result'])
      expect(ev[0]).toMatchObject({ sessionId: '0199a213-81c0-7800-8aa1-bbab2a035a53' })
      expect(ev[1]).toMatchObject({ role: 'assistant', text: 'Hello there, friend!' })
    }
  })
  it('maps commands, file changes and mcp calls', () => {
    const ev = fixture('tool-use.jsonl', 100000)
    expect(ev.map((e) => e.type)).toEqual([
      'start',
      'tool_use',
      'tool_result',
      'tool_use',
      'tool_result',
      'tool_use',
      'tool_result',
      'tool_use',
      'tool_result',
      'message',
      'result'
    ])
    expect(ev[2]).toMatchObject({ content: 'README.md\n', isError: false })
    expect(ev[4]).toMatchObject({ isError: true })
    expect(ev[7]).toMatchObject({ name: 'gate.ping', input: { x: 1 } })
  })
  it('maps failure to a failed result', () => {
    const ev = fixture('failed.jsonl', 100000)
    expect(ev.at(-1)).toMatchObject({ type: 'result', success: false, text: 'stream disconnected' })
  })
  it('keeps unknown and non-JSON lines as logs', () => {
    expect(parseLine('plain text')).toEqual([{ type: 'log', source: 'stdout', line: 'plain text' }])
    expect(parseLine('{"type":"future.event"}')[0]).toMatchObject({ type: 'log' })
    expect(parseLine('[1]')[0]).toMatchObject({ type: 'log' })
  })
})

describe('codex usage', () => {
  it('reads token numbers only', () => {
    const line =
      '{"type":"turn.completed","usage":{"input_tokens":5,"cached_input_tokens":2,"output_tokens":3},"account":"x"}'
    expect(extractCodexUsage(line)).toEqual({
      costUsd: null,
      durationMs: null,
      numTurns: 1,
      inputTokens: 5,
      outputTokens: 3,
      cacheReadTokens: 2,
      cacheCreationTokens: null
    })
    expect(extractCodexUsage('{"type":"turn.started"}')).toBeNull()
    expect(extractCodexUsage('nope')).toBeNull()
  })
})

describe('CodexAdapter', () => {
  it('spawns exec with args array, no shell, prompt after --', () => {
    const { adapter, calls } = setup()
    expect(adapter.start({ prompt: '--evil $(rm -rf /)' }, () => undefined).ok).toBe(true)
    const [cmd, args, opts] = calls[0] as [string, string[], { shell: boolean }]
    expect(cmd).toBe('codex')
    expect(args.slice(0, 3)).toEqual(['exec', '--json', '--sandbox'])
    expect(args).not.toContain('--dangerously-bypass-approvals-and-sandbox')
    expect(args.slice(-2)).toEqual(['--', '--evil $(rm -rf /)'])
    expect(opts.shell).toBe(false)
  })
  it('streams events, reports usage, and exits', () => {
    const usage: unknown[] = []
    const { adapter, child } = setup({ onUsage: (_id, u) => usage.push(u) })
    const events: RunEvent[] = []
    adapter.start({ prompt: 'hi' }, (e) => events.push(e))
    child.stdout.write(readFileSync(join(__dirname, '__fixtures__', 'text-only.jsonl')))
    child.emit('close', 0, null)
    expect(events.map((e) => e.type)).toEqual(['start', 'message', 'result', 'exit'])
    expect(usage).toHaveLength(1)
  })
  it('cancels a run', async () => {
    const { adapter, child } = setup()
    const events: RunEvent[] = []
    const r = adapter.start({ prompt: 'hi' }, (e) => events.push(e))
    if (!r.ok) throw new Error('start failed')
    expect(adapter.cancel(r.runId)).toBe(true)
    await Promise.resolve()
    expect(child.killed).toContain('SIGTERM')
    expect(events.some((e) => e.type === 'error' && e.code === 'cancelled')).toBe(true)
    expect(adapter.cancel('unknown')).toBe(false)
  })
  it('rejects tool and hr launch options and declares no capabilities', () => {
    const { adapter, calls } = setup()
    expect(adapter.capabilities).toEqual({ toolBridge: false, pathScopedWrites: false })
    let finished = 0
    const r = adapter.start({ prompt: 'x' }, () => undefined, {
      hr: { settingsPath: '/tmp/s.json' },
      onFinish: () => void finished++
    })
    expect(r).toMatchObject({ ok: false, code: 'spawn-failed' })
    expect(calls).toHaveLength(0)
  })
  it('rejects invalid requests', () => {
    expect(setup().adapter.start({ prompt: '' }, () => undefined)).toMatchObject({
      ok: false,
      code: 'invalid-request'
    })
  })
  it('checks install via --version', async () => {
    const child = new FakeChild()
    const spawnFn: SpawnFn = () => child as unknown as ChildProcess
    const p = new CodexAdapter({ cwd: '/w', spawnFn }).checkInstall()
    child.stdout.write('codex-cli 0.166.0\n')
    child.emit('close', 0, null)
    expect(await p).toEqual({ installed: true, version: 'codex-cli 0.166.0' })
  })
})

describe('codexAgentTranslator', () => {
  it('builds one AGENTS.md', () => {
    const out = codexAgentTranslator.translate([
      {
        name: 'dev',
        description: 'builds\n## x',
        tools: ['Read', 'Edit'],
        model: 'sonnet',
        prompt: 'Do work.\n'
      }
    ])
    expect(out).toHaveLength(1)
    expect(out[0]?.relativePath).toBe('AGENTS.md')
    expect(out[0]?.content).toContain('## dev')
    expect(out[0]?.content).toContain('역할: builds ## x')
    expect(out[0]?.content).toContain('참고 도구: Read, Edit')
    expect(out[0]?.content).toContain('Do work.')
  })
  it('returns nothing for no agents', () => {
    expect(codexAgentTranslator.translate([])).toEqual([])
  })
})
