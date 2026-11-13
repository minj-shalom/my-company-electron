import { PROVIDER_CLI_IDS, type ProviderCliId } from '../../shared/provider'
import { PROJECT_ID } from '../../shared/project'
import type { UsageRecord } from '../../shared/usage'
import { EMPLOYEE_ID, TICKET_ID } from '../repository/ids'
import type { ProviderUsage } from '../providers/types'

/** 누가·어느 프로젝트의 어느 티켓 때문에 쓴 사용량인지. 모르는 값은 null로 두고 추정하지 않는다. */
export interface UsageAttribution {
  project: string | null
  employee: string | null
  ticket: string | null
}

const nonNeg = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null
const matching = (v: unknown, re: RegExp): string | null =>
  typeof v === 'string' && re.test(v) ? v : null

/** 어댑터가 뽑은 숫자와 귀속만 담는다. 입력은 신뢰하지 않고 형식에 맞지 않는 귀속 값은 null로 버린다. */
export function buildUsageRecord(
  provider: ProviderCliId,
  usage: ProviderUsage,
  attribution: Partial<UsageAttribution>,
  at: Date
): UsageRecord {
  return {
    v: 1,
    at: at.toISOString(),
    provider,
    project: matching(attribution.project, PROJECT_ID),
    employee: matching(attribution.employee, EMPLOYEE_ID),
    ticket: matching(attribution.ticket, TICKET_ID),
    requests: 1,
    costUsd: nonNeg(usage.costUsd),
    inputTokens: nonNeg(usage.inputTokens),
    outputTokens: nonNeg(usage.outputTokens),
    cacheReadTokens: nonNeg(usage.cacheReadTokens),
    cacheCreationTokens: nonNeg(usage.cacheCreationTokens),
    durationMs: nonNeg(usage.durationMs)
  }
}

/** 파일은 마크다운이다: 제목 아래 기록 한 건이 `- {json}` 한 줄이다. */
export function renderUsageLine(r: UsageRecord): string {
  return `- ${JSON.stringify(r)}`
}

export function renderUsageFileHeader(day: string): string {
  return `# 사용량 기록 ${day}\n\n> 앱이 실행 결과에서 비용·토큰 숫자만 기록합니다. 인증 정보는 없습니다. 직접 수정하지 마세요.\n\n`
}

/**
 * 한 줄을 기록으로 읽는다. 귀속·요청 수 필드가 없는 과거 기록도 오류 없이 읽는다 (null = 회사 공통/미분류).
 * 시각이나 제공자를 알 수 없는 줄은 집계할 수 없으므로 버린다.
 */
export function parseUsageLine(line: string): UsageRecord | null {
  if (!line.startsWith('- {')) return null
  let raw: unknown
  try {
    raw = JSON.parse(line.slice(2))
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  if (typeof o.at !== 'string' || Number.isNaN(Date.parse(o.at))) return null
  if (!PROVIDER_CLI_IDS.includes(o.provider as ProviderCliId)) return null
  return {
    v: 1,
    at: new Date(o.at).toISOString(),
    provider: o.provider as ProviderCliId,
    project: matching(o.project, PROJECT_ID),
    employee: matching(o.employee, EMPLOYEE_ID),
    ticket: matching(o.ticket, TICKET_ID),
    requests: nonNeg(o.requests) ?? 1,
    costUsd: nonNeg(o.costUsd),
    inputTokens: nonNeg(o.inputTokens),
    outputTokens: nonNeg(o.outputTokens),
    cacheReadTokens: nonNeg(o.cacheReadTokens),
    cacheCreationTokens: nonNeg(o.cacheCreationTokens),
    durationMs: nonNeg(o.durationMs)
  }
}

export function parseUsageFile(text: string): UsageRecord[] {
  const out: UsageRecord[] = []
  for (const line of text.split(/\r?\n/)) {
    const r = parseUsageLine(line)
    if (r !== null) out.push(r)
  }
  return out
}
