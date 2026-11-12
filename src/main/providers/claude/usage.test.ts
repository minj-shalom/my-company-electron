import { describe, expect, it } from 'vitest'
import { extractClaudeUsage } from './usage'

describe('extractClaudeUsage', () => {
  it('reads cost and token numbers from a result line', () => {
    const line = JSON.stringify({
      type: 'result',
      subtype: 'success',
      total_cost_usd: 0.05,
      duration_ms: 1200,
      num_turns: 2,
      usage: {
        input_tokens: 10,
        output_tokens: 20,
        cache_read_input_tokens: 30,
        cache_creation_input_tokens: 40
      }
    })
    expect(extractClaudeUsage(line)).toEqual({
      costUsd: 0.05,
      durationMs: 1200,
      numTurns: 2,
      inputTokens: 10,
      outputTokens: 20,
      cacheReadTokens: 30,
      cacheCreationTokens: 40
    })
  })

  it('returns nulls for missing or non-numeric fields', () => {
    expect(extractClaudeUsage('{"type":"result","total_cost_usd":"x"}')).toMatchObject({
      costUsd: null,
      inputTokens: null
    })
  })

  it('ignores non-result and unparseable lines', () => {
    expect(extractClaudeUsage('{"type":"assistant"}')).toBeNull()
    expect(extractClaudeUsage('not json')).toBeNull()
    expect(extractClaudeUsage('42')).toBeNull()
  })

  it('never carries auth-related fields', () => {
    const line = JSON.stringify({
      type: 'result',
      apiKeySource: 'secret-source',
      session_id: 's',
      token: 'tok-123',
      usage: { input_tokens: 1, api_key: 'k' }
    })
    const out = JSON.stringify(extractClaudeUsage(line))
    expect(out).not.toMatch(/secret-source|tok-123|api_key|apiKeySource/)
  })
})
