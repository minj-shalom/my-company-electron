import type { WeeklyLimit } from '../../shared/provider'
import { PROVIDER_CLI_IDS } from '../../shared/provider'
import type {
  ProviderUsageView,
  UsageBreakdownItem,
  UsageRecord,
  UsageSettings,
  UsageTotals,
  UsageWidgetData
} from '../../shared/usage'
import type { UsageWindow } from './usage-window'

interface Acc {
  requests: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  costUsd: number
  costKnown: boolean
}

const empty = (): Acc => ({
  requests: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  costUsd: 0,
  costKnown: false
})

function add(a: Acc, r: UsageRecord): void {
  a.requests += r.requests
  a.inputTokens += r.inputTokens ?? 0
  a.outputTokens += r.outputTokens ?? 0
  a.cacheReadTokens += r.cacheReadTokens ?? 0
  a.cacheCreationTokens += r.cacheCreationTokens ?? 0
  if (r.costUsd !== null) {
    a.costUsd += r.costUsd
    a.costKnown = true
  }
}

const finish = (a: Acc): UsageTotals => ({
  requests: a.requests,
  inputTokens: a.inputTokens,
  outputTokens: a.outputTokens,
  cacheReadTokens: a.cacheReadTokens,
  cacheCreationTokens: a.cacheCreationTokens,
  // 부동소수점 누적 오차를 센트 아래로 정리한다.
  costUsd: a.costKnown ? Math.round(a.costUsd * 1e6) / 1e6 : null
})

export function inWindow(r: UsageRecord, w: UsageWindow): boolean {
  const t = Date.parse(r.at)
  return t >= w.start.getTime() && t < w.end.getTime()
}

/** 그룹 키 null(회사 공통/미분류)은 맨 뒤, 나머지는 비용 큰 순 → 요청 많은 순 → 키 순. */
function breakdown(
  records: readonly UsageRecord[],
  pick: (r: UsageRecord) => string | null
): UsageBreakdownItem[] {
  const map = new Map<string | null, Acc>()
  for (const r of records) {
    const k = pick(r)
    const a = map.get(k) ?? empty()
    add(a, r)
    map.set(k, a)
  }
  return [...map.entries()]
    .map(([key, a]) => ({ key, totals: finish(a) }))
    .sort((x, y) => {
      if ((x.key === null) !== (y.key === null)) return x.key === null ? 1 : -1
      const d = (y.totals.costUsd ?? 0) - (x.totals.costUsd ?? 0)
      if (d !== 0) return d
      const q = y.totals.requests - x.totals.requests
      return q !== 0 ? q : String(x.key).localeCompare(String(y.key))
    })
}

export function providerView(
  provider: ProviderUsageView['provider'],
  records: readonly UsageRecord[],
  limit: WeeklyLimit | undefined,
  settings: UsageSettings
): ProviderUsageView {
  const a = empty()
  for (const r of records) if (r.provider === provider) add(a, r)
  const totals = finish(a)
  const base = {
    provider,
    totals,
    unit: limit?.unit ?? null,
    limitAmount: limit?.amount ?? null,
    estimated: limit?.unit === 'subscription-percent'
  }
  if (limit === undefined)
    return { ...base, percent: null, costKrw: null, status: 'no-limit', estimated: false }
  // 기록이 있는데 CLI가 비용을 한 번도 알려 주지 않았다면 사용률을 계산할 수 없다 (0%로 속이지 않는다).
  const unknown = totals.costUsd === null && totals.requests > 0
  const percent = unknown ? null : ((totals.costUsd ?? 0) / limit.amount) * 100
  const status = unknown
    ? 'unknown'
    : percent! >= 100
      ? 'exceeded'
      : percent! >= settings.warnPercent
        ? 'warn'
        : 'ok'
  return {
    ...base,
    percent,
    costKrw:
      limit.unit === 'usd' && totals.costUsd !== null
        ? Math.round(totals.costUsd * settings.krwPerUsd)
        : null,
    status
  }
}

/** 회사 단위 합계. `records`는 이미 주간 구간으로 걸러진 것이어야 한다. */
export function buildWidgetData(
  records: readonly UsageRecord[],
  limits: readonly WeeklyLimit[],
  settings: UsageSettings,
  w: UsageWindow
): UsageWidgetData {
  const all = empty()
  for (const r of records) add(all, r)
  return {
    windowStart: w.start.toISOString(),
    windowEnd: w.end.toISOString(),
    settings,
    providers: PROVIDER_CLI_IDS.map((p) =>
      providerView(
        p,
        records,
        limits.find((l) => l.provider === p),
        settings
      )
    ),
    byProject: breakdown(records, (r) => r.project),
    byEmployee: breakdown(records, (r) => r.employee),
    total: finish(all)
  }
}
