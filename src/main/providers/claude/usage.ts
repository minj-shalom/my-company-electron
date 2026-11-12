import type { ProviderUsage } from '../types'

type Json = Record<string, unknown>

function asObject(v: unknown): Json | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Json) : null
}
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/**
 * stream-json의 result 줄에서 비용/토큰 숫자만 읽는다. 읽을 키를 명시적으로 나열하며,
 * 그 외 필드(apiKeySource, 계정/조직 정보 등)는 접근하지 않는다.
 */
export function extractClaudeUsage(line: string): ProviderUsage | null {
  let data: unknown
  try {
    data = JSON.parse(line)
  } catch {
    return null
  }
  const root = asObject(data)
  if (!root || root['type'] !== 'result') return null
  const usage = asObject(root['usage'])
  return {
    costUsd: num(root['total_cost_usd']),
    durationMs: num(root['duration_ms']),
    numTurns: num(root['num_turns']),
    inputTokens: num(usage?.['input_tokens']),
    outputTokens: num(usage?.['output_tokens']),
    cacheReadTokens: num(usage?.['cache_read_input_tokens']),
    cacheCreationTokens: num(usage?.['cache_creation_input_tokens'])
  }
}
