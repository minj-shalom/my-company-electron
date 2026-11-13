import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RunEvent, RunEventBody } from '../../../shared/run'
import type { SpawnFn } from '../cli-runner'
import { buildCliEnv } from '../cli-env'
import { LineBuffer } from '../line-buffer'
import { geminiAgentTranslator } from './agent-translator'
import { GeminiAdapter } from './gemini-adapter'
import { MAX_LOG_LINE, MAX_MESSAGE_TEXT, MAX_TOOL_OUTPUT, parseLine } from './parser'
import { extractGeminiUsage } from './usage'

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

function setup(extra: Partial<ConstructorParameters<typeof GeminiAdapter>[0]> = {}): {
  child: FakeChild
  calls: unknown[][]
  adapter: GeminiAdapter
} {
  const child = new FakeChild()
  const calls: unknown[][] = []
  const spawnFn: SpawnFn = (...a) => {
    calls.push(a)
    return child as unknown as ChildProcess
  }
  return { child, calls, adapter: new GeminiAdapter({ cwd: '/work', spawnFn, ...extra }) }
}

function fixture(name: string, chunk: number): RunEventBody[] {
  const text = readFileSync(join(__dirname, '__fixtures__', name), 'utf8')
  const buf = new LineBuffer()
  const lines: string[] = []
  for (let i = 0; i < text.length; i += chunk) lines.push(...buf.push(text.slice(i, i + chunk)))
  lines.push(...buf.flush())
  return lines.flatMap(parseLine)
}

afterEach(() => vi.useRealTimers())

describe('gemini parser', () => {
  it('parses text-only fixture regardless of chunking, skipping user echo', () => {
    for (const chunk of [100000, 7, 1]) {
      const ev = fixture('text-only.jsonl', chunk)
      expect(ev.map((e) => e.type)).toEqual(['start', 'message', 'message', 'result'])
      expect(ev[0]).toMatchObject({ sessionId: 's-1', model: 'gemini-sample' })
      expect(ev[3]).toMatchObject({ success: true, durationMs: 120 })
    }
  })
  it('parses tool use, results and errors', () => {
    const ev = fixture('tool-use.jsonl', 100000)
    expect(ev.map((e) => e.type)).toEqual([
      'start',
      'tool_use',
      'tool_result',
      'tool_use',
      'tool_result',
      'message',
      'result'
    ])
    expect(ev[1]).toMatchObject({ name: 'run_shell_command', input: { command: 'ls' } })
    expect(ev[2]).toMatchObject({ content: 'README.md\n', isError: false })
    expect(ev[4]).toMatchObject({ content: 'not found', isError: true })
  })
  it('maps failure to a failed result and keeps warnings as logs', () => {
    const ev = fixture('failed.jsonl', 100000)
    expect(ev[1]).toMatchObject({ type: 'log', line: 'quota nearly exceeded' })
    expect(ev.at(-1)).toMatchObject({ type: 'result', success: false, text: 'request failed' })
  })
  it('keeps unknown and non-JSON lines as logs', () => {
    expect(parseLine('plain text')).toEqual([{ type: 'log', source: 'stdout', line: 'plain text' }])
    expect(parseLine('{"type":"future.event"}')[0]).toMatchObject({ type: 'log' })
    expect(parseLine('[1]')[0]).toMatchObject({ type: 'log' })
    expect(parseLine('{"type":"message","role":"system","content":"x"}')[0]).toMatchObject({
      type: 'log'
    })
  })
  it('caps log lines, message text, tool output and tool input', () => {
    const long = 'x'.repeat(MAX_MESSAGE_TEXT + 500)
    const log = parseLine(long)[0]
    expect(log).toMatchObject({ type: 'log' })
    expect((log as { line: string }).line).toHaveLength(MAX_LOG_LINE)
    const giant = JSON.stringify({
      type: 'message',
      role: 'assistant',
      content: 'y'.repeat(5_000_000)
    })
    const g = parseLine(giant)
    expect(g).toHaveLength(1)
    expect(g[0]).toMatchObject({ type: 'log' })
    expect((g[0] as { line: string }).line.length).toBeLessThanOrEqual(MAX_LOG_LINE)
    const msg = parseLine(JSON.stringify({ type: 'message', role: 'assistant', content: long }))[0]
    expect((msg as { text: string }).text).toHaveLength(MAX_MESSAGE_TEXT)
    const out = parseLine(
      JSON.stringify({
        type: 'tool_result',
        tool_id: 't',
        status: 'success',
        output: 'o'.repeat(50000)
      })
    )[0]
    expect((out as { content: string }).content).toHaveLength(MAX_TOOL_OUTPUT)
    const inp = parseLine(
      JSON.stringify({
        type: 'tool_use',
        tool_id: 't',
        tool_name: 'w',
        parameters: { c: 'z'.repeat(50000) }
      })
    )[0]
    expect(inp).toMatchObject({ input: { truncated: true } })
  })
})

describe('gemini usage', () => {
  it('reads token numbers only', () => {
    const line =
      '{"type":"result","status":"success","stats":{"input_tokens":5,"output_tokens":3,"cached":2,"duration_ms":9},"account":"x"}'
    expect(extractGeminiUsage(line)).toEqual({
      costUsd: null,
      durationMs: 9,
      numTurns: 1,
      inputTokens: 5,
      outputTokens: 3,
      cacheReadTokens: 2,
      cacheCreationTokens: null
    })
    expect(extractGeminiUsage('{"type":"init"}')).toBeNull()
    expect(extractGeminiUsage('nope')).toBeNull()
    expect(extractGeminiUsage('{"type":"result"' + ' '.repeat(200000))).toBeNull()
  })
})

describe('GeminiAdapter', () => {
  it('spawns with args array, no shell, prompt bound to --prompt=', () => {
    const { adapter, calls } = setup()
    expect(adapter.start({ prompt: '--yolo $(rm -rf /)' }, () => undefined).ok).toBe(true)
    const [cmd, args, opts] = calls[0] as [string, string[], { shell: boolean; cwd: string }]
    expect(cmd).toBe('gemini')
    expect(args).toEqual([
      '--prompt=--yolo $(rm -rf /)',
      '--output-format',
      'stream-json',
      '--approval-mode',
      'auto_edit'
    ])
    expect(args).not.toContain('--yolo')
    expect(opts.shell).toBe(false)
    expect(opts.cwd).toBe('/work')
  })
  it('does not pass GEMINI_ credentials by default, only with explicit prefixes', () => {
    const source = { PATH: '/bin', GEMINI_API_KEY: 'dummy', GOOGLE_API_KEY: 'dummy' }
    expect(buildCliEnv(source)).toEqual({ PATH: '/bin' })
    expect(buildCliEnv(source, ['GEMINI_'])).toEqual({ PATH: '/bin', GEMINI_API_KEY: 'dummy' })
    expect(buildCliEnv(source, [''])).toEqual({ PATH: '/bin' })
  })
  it('streams events, reports usage, and exits', () => {
    const usage: unknown[] = []
    const { adapter, child } = setup({ onUsage: (_id, u) => usage.push(u) })
    const events: RunEvent[] = []
    adapter.start({ prompt: 'hi' }, (e) => events.push(e))
    child.stdout.write(readFileSync(join(__dirname, '__fixtures__', 'text-only.jsonl')))
    child.emit('close', 0, null)
    expect(events.map((e) => e.type)).toEqual(['start', 'message', 'message', 'result', 'exit'])
    expect(usage).toHaveLength(1)
  })
  it('handles a giant stdout line and caps stderr lines', () => {
    const { adapter, child } = setup()
    const events: RunEvent[] = []
    adapter.start({ prompt: 'hi' }, (e) => events.push(e))
    child.stdout.write(
      '{"type":"message","role":"assistant","content":"' + 'a'.repeat(3_000_000) + '"}\n'
    )
    child.stderr.write('e'.repeat(10000) + '\n')
    child.emit('close', 0, null)
    const lines = events.filter((e) => e.type === 'log') as Array<{ line: string }>
    expect(lines).toHaveLength(2)
    expect(lines.every((l) => l.line.length <= MAX_LOG_LINE)).toBe(true)
  })
  it('reports a failed run with non-zero exit', () => {
    const { adapter, child } = setup()
    const events: RunEvent[] = []
    adapter.start({ prompt: 'hi' }, (e) => events.push(e))
    child.stdout.write(readFileSync(join(__dirname, '__fixtures__', 'failed.jsonl')))
    child.emit('close', 1, null)
    expect(events.map((e) => e.type)).toEqual(['start', 'log', 'result', 'error', 'exit'])
    expect(events.at(-2)).toMatchObject({ code: 'exit-nonzero' })
  })
  it('maps ENOENT to cli-not-found', () => {
    const { adapter, child } = setup()
    const events: RunEvent[] = []
    adapter.start({ prompt: 'hi' }, (e) => events.push(e))
    child.emit('error', Object.assign(new Error('spawn gemini ENOENT'), { code: 'ENOENT' }))
    expect(events.find((e) => e.type === 'error')).toMatchObject({ code: 'cli-not-found' })
    expect(events.at(-1)?.type).toBe('exit')
  })
  it('returns spawn-failed when spawn throws, without leaking details', () => {
    const adapter = new GeminiAdapter({
      cwd: '/w',
      spawnFn: () => {
        throw new Error('/secret/path boom')
      }
    })
    const r = adapter.start({ prompt: 'hi' }, () => undefined)
    expect(r).toMatchObject({ ok: false, code: 'spawn-failed' })
    expect(JSON.stringify(r)).not.toContain('secret')
  })
  it('times out a run', () => {
    vi.useFakeTimers()
    const { adapter, child } = setup()
    const events: RunEvent[] = []
    adapter.start({ prompt: 'hi', timeoutMs: 1000 }, (e) => events.push(e))
    vi.advanceTimersByTime(1000)
    expect(child.killed).toContain('SIGTERM')
    child.emit('close', null, 'SIGTERM')
    expect(events.find((e) => e.type === 'error')).toMatchObject({ code: 'timeout' })
  })
  it('force-kills when SIGTERM is ignored', () => {
    vi.useFakeTimers()
    const { adapter, child } = setup()
    child.kill = (sig: string): boolean => {
      child.killed.push(sig)
      return true
    }
    const r = adapter.start({ prompt: 'hi' }, () => undefined)
    if (!r.ok) throw new Error('start failed')
    adapter.cancel(r.runId)
    vi.advanceTimersByTime(3000)
    expect(child.killed).toEqual(['SIGTERM', 'SIGKILL'])
  })
  it('cancels a run and cancelAll', async () => {
    const { adapter, child } = setup()
    const events: RunEvent[] = []
    const r = adapter.start({ prompt: 'hi' }, (e) => events.push(e))
    if (!r.ok) throw new Error('start failed')
    expect(adapter.cancel(r.runId)).toBe(true)
    await Promise.resolve()
    expect(child.killed).toContain('SIGTERM')
    expect(events.some((e) => e.type === 'error' && e.code === 'cancelled')).toBe(true)
    expect(adapter.cancel('unknown')).toBe(false)
    const b = setup()
    const ev2: RunEvent[] = []
    b.adapter.start({ prompt: 'hi' }, (e) => ev2.push(e))
    b.adapter.cancelAll()
    await Promise.resolve()
    expect(ev2.some((e) => e.type === 'error' && e.code === 'cancelled')).toBe(true)
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
    const s = setup().adapter
    expect(s.start({ prompt: '' }, () => undefined)).toMatchObject({ code: 'invalid-request' })
    expect(s.start({ prompt: 'x', timeoutMs: 1 }, () => undefined)).toMatchObject({
      code: 'invalid-request'
    })
  })
  it('checks install via --version', async () => {
    const child = new FakeChild()
    const spawnFn: SpawnFn = () => child as unknown as ChildProcess
    const p = new GeminiAdapter({ cwd: '/w', spawnFn }).checkInstall()
    child.stdout.write('0.37.0\n')
    child.emit('close', 0, null)
    expect(await p).toEqual({ installed: true, version: '0.37.0' })
  })
})

describe('geminiAgentTranslator', () => {
  it('builds one GEMINI.md', () => {
    const out = geminiAgentTranslator.translate([
      {
        name: 'dev\n# x',
        description: 'builds\n## x',
        tools: ['Read'],
        model: null,
        prompt: 'Do work.\n'
      }
    ])
    expect(out).toHaveLength(1)
    expect(out[0]?.relativePath).toBe('GEMINI.md')
    expect(out[0]?.content).toContain('## dev # x')
    expect(out[0]?.content).toContain('역할: builds ## x')
    expect(out[0]?.content).toContain('참고 도구: Read')
    expect(out[0]?.content).toContain('Do work.')
  })
  it('returns nothing for no agents', () => {
    expect(geminiAgentTranslator.translate([])).toEqual([])
  })
})
