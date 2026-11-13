import type { ProviderUsage } from '../types'

type Json = Record<string, unknown>

function asObject(v: unknown): Json | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Json) : null
}
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** `turn.completed`의 usage 숫자만 읽는다. codex는 비용(USD)을 주지 않아 costUsd는 null이다. */
export function extractCodexUsage(line: string): ProviderUsage | null {
  let data: unknown
  try {
    data = JSON.parse(line)
  } catch {
    return null
  }
  const root = asObject(data)
  if (!root || root['type'] !== 'turn.completed') return null
  const usage = asObject(root['usage'])
  return {
    costUsd: null,
    durationMs: null,
    numTurns: 1,
    inputTokens: num(usage?.['input_tokens']),
    outputTokens: num(usage?.['output_tokens']),
    cacheReadTokens: num(usage?.['cached_input_tokens']),
    cacheCreationTokens: null
  }
}
