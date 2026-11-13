import type { ProviderUsage } from '../types'

type Json = Record<string, unknown>

function asObject(v: unknown): Json | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Json) : null
}
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** `result`의 stats 숫자만 읽는다. gemini는 비용(USD)을 주지 않아 costUsd는 null이다. */
export function extractGeminiUsage(line: string): ProviderUsage | null {
  // 거대 줄은 파싱하지 않는다. 사용량 줄은 작다.
  if (line.length > 100_000 || !line.includes('"result"')) return null
  let data: unknown
  try {
    data = JSON.parse(line)
  } catch {
    return null
  }
  const root = asObject(data)
  if (!root || root['type'] !== 'result') return null
  const stats = asObject(root['stats'])
  return {
    costUsd: null,
    durationMs: num(stats?.['duration_ms']),
    numTurns: 1,
    inputTokens: num(stats?.['input_tokens']),
    outputTokens: num(stats?.['output_tokens']),
    cacheReadTokens: num(stats?.['cached']),
    cacheCreationTokens: null
  }
}
