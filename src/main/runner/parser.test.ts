import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LineBuffer, parseLine } from './parser'
import type { RunEventBody } from '../../shared/run'

function parseFixture(name: string, chunkSize: number): RunEventBody[] {
  const text = readFileSync(join(__dirname, '__fixtures__', name), 'utf8')
  const buf = new LineBuffer()
  const lines: string[] = []
  for (let i = 0; i < text.length; i += chunkSize)
    lines.push(...buf.push(text.slice(i, i + chunkSize)))
  lines.push(...buf.flush())
  return lines.flatMap(parseLine)
}

describe('LineBuffer', () => {
  it('joins lines split across chunks', () => {
    const b = new LineBuffer()
    expect(b.push('{"a":')).toEqual([])
    expect(b.push('1}\n{"b":2}\n{"c"')).toEqual(['{"a":1}', '{"b":2}'])
    expect(b.push(':3}')).toEqual([])
    expect(b.flush()).toEqual(['{"c":3}'])
  })
  it('handles CRLF and blank lines', () => {
    expect(new LineBuffer().push('a\r\n\r\nb\n')).toEqual(['a', 'b'])
  })
})

describe('parseLine', () => {
  it('parses text-only fixture regardless of chunk size', () => {
    for (const size of [1, 7, 64, 100000]) {
      const ev = parseFixture('text-only.jsonl', size)
      expect(ev.map((e) => e.type)).toEqual(['start', 'message', 'result'])
      expect(ev[0]).toMatchObject({ sessionId: '51a0afe1-8d53-48f7-bcd1-bb247bdcc9df' })
      expect(ev[1]).toMatchObject({ role: 'assistant', text: 'Hello there, friend!' })
      expect(ev[2]).toMatchObject({ success: true, costUsd: 0.0095009, numTurns: 1 })
    }
  })
  it('parses tool use and tool result', () => {
    const ev = parseFixture('tool-use.jsonl', 13)
    expect(ev.map((e) => e.type)).toEqual(['start', 'tool_use', 'tool_result', 'message', 'result'])
    expect(ev[1]).toMatchObject({ name: 'Read', toolUseId: 'toolu_01J6' })
    expect(ev[2]).toMatchObject({ toolUseId: 'toolu_01J6', isError: false })
  })
  it('keeps unparseable lines as log events', () => {
    expect(parseLine('not json')).toEqual([{ type: 'log', source: 'stdout', line: 'not json' }])
    expect(parseLine('42')).toEqual([{ type: 'log', source: 'stdout', line: '42' }])
  })
  it('keeps unknown event types as log, drops rate_limit_event', () => {
    expect(parseLine('{"type":"future_thing"}')).toHaveLength(1)
    expect(parseLine('{"type":"rate_limit_event"}')).toEqual([])
  })
  it('marks error results as unsuccessful', () => {
    const [e] = parseLine('{"type":"result","subtype":"error_max_turns","is_error":true}')
    expect(e).toMatchObject({ type: 'result', success: false, subtype: 'error_max_turns' })
  })
})
