import type { WindowApi } from '../../shared/api'
import { PROVIDER_CLI_IDS, type ProviderCliId, type WeeklyLimit } from '../../shared/provider'
import {
  DEFAULT_PROVIDER,
  MAX_PROVIDER_OVERRIDES,
  isProviderCliIdValue,
  type ProviderSelection
} from '../../shared/provider-selection'
import {
  USAGE_SETTINGS_DEFAULT,
  validateUsageSettings,
  type ProviderUsageView,
  type UsageBreakdownItem,
  type UsageSettings,
  type UsageTotals,
  type UsageWidgetData
} from '../../shared/usage'

/**
 * 브라우저 개발 모드 전용. `?mock-usage=ok|warn|error|loading`.
 * 파라미터가 없으면 집계가 비어 있는 기본 상태(한도 미설정)다. ok/warn은 프로젝트 3개, 직원 7명의 집계와 한도를 미리 채운다.
 *  - ok: Claude 구독 기준값 대비 약 69%(추정), Codex 종량제 약 47%, Gemini는 한도는 있으나 비용을 알 수 없음.
 *  - warn: Claude 한도 초과, Codex 경고 기준 초과, Gemini 알 수 없음.
 */
export type UsageScenario = 'default' | 'ok' | 'warn' | 'error' | 'loading'
const SCENARIOS: readonly UsageScenario[] = ['default', 'ok', 'warn', 'error', 'loading']

export function parseUsageScenario(search: string): UsageScenario {
  const v = new URLSearchParams(search).get('mock-usage')
  return SCENARIOS.find((s) => s === v) ?? 'default'
}

interface Row {
  provider: ProviderCliId
  project: string | null
  employee: string | null
  requests: number
  /** null = CLI가 비용을 알려 주지 않음. */
  cost: number | null
}

const ROWS: readonly Row[] = [
  { provider: 'claude', project: 'my-company', employee: 'ui-dev', requests: 61, cost: 14.8 },
  { provider: 'claude', project: 'my-company', employee: 'developer', requests: 44, cost: 9.6 },
  { provider: 'claude', project: 'my-company', employee: 'reviewer-qa', requests: 30, cost: 4.1 },
  { provider: 'claude', project: 'landing', employee: 'developer', requests: 28, cost: 5.3 },
  { provider: 'claude', project: 'blog', employee: 'pm', requests: 19, cost: 2.4 },
  { provider: 'claude', project: null, employee: 'cto', requests: 12, cost: 3.2 },
  { provider: 'claude', project: null, employee: 'cfo', requests: 9, cost: 0.9 },
  { provider: 'claude', project: 'my-company', employee: null, requests: 5, cost: 1.1 },
  { provider: 'codex', project: 'landing', employee: 'developer', requests: 40, cost: 8.5 },
  { provider: 'codex', project: 'my-company', employee: 'developer', requests: 15, cost: 3.2 },
  { provider: 'gemini', project: 'blog', employee: 'pm', requests: 22, cost: null },
  { provider: 'gemini', project: null, employee: 'hr', requests: 8, cost: null }
]

const SEED_LIMITS: WeeklyLimit[] = [
  { provider: 'claude', amount: 60, unit: 'subscription-percent' },
  { provider: 'codex', amount: 25, unit: 'usd' },
  { provider: 'gemini', amount: 15, unit: 'subscription-percent' }
]

const EMPTY_TOTALS: UsageTotals = {
  requests: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  costUsd: null
}

function add(t: UsageTotals, r: Row, scale: number): UsageTotals {
  const cost = r.cost === null ? null : r.cost * scale
  return {
    requests: t.requests + r.requests,
    inputTokens: t.inputTokens + r.requests * 3000,
    outputTokens: t.outputTokens + r.requests * 1200,
    cacheReadTokens: t.cacheReadTokens + r.requests * 4000,
    cacheCreationTokens: t.cacheCreationTokens + r.requests * 800,
    // 알려 준 값이 하나도 없으면 null을 유지한다 (0으로 채우지 않는다).
    costUsd: cost === null ? t.costUsd : (t.costUsd ?? 0) + cost
  }
}

const sum = (rows: readonly Row[], scale: (r: Row) => number): UsageTotals =>
  rows.reduce((t, r) => add(t, r, scale(r)), EMPTY_TOTALS)

function breakdown(
  rows: readonly Row[],
  keyOf: (r: Row) => string | null,
  scale: (r: Row) => number
): UsageBreakdownItem[] {
  const keys = [...new Set(rows.map(keyOf))]
  return keys.map((key) => ({
    key,
    totals: sum(
      rows.filter((r) => keyOf(r) === key),
      scale
    )
  }))
}

type Mock = Pick<
  WindowApi,
  | 'getUsageWidget'
  | 'getUsageSettings'
  | 'saveUsageSettings'
  | 'getProviderSelection'
  | 'saveProviderSelection'
>

export function createMockUsageApi(
  scenario: UsageScenario,
  delayMs: number,
  limits: {
    get: () => Promise<{ ok: true; value: WeeklyLimit[] } | { ok: false }>
    seed: (l: WeeklyLimit[]) => void
  }
): { api: Mock; reset: () => void } {
  let settings: UsageSettings = { ...USAGE_SETTINGS_DEFAULT }
  let selection: ProviderSelection = { defaultProvider: DEFAULT_PROVIDER, overrides: {} }
  const seeded = scenario === 'ok' || scenario === 'warn'
  const scale = (r: Row): number =>
    scenario === 'warn' ? (r.provider === 'claude' ? 1.5 : r.provider === 'codex' ? 2 : 1) : 1
  const wait = (): Promise<void> => new Promise((res) => setTimeout(res, delayMs))
  const apply = (): void => {
    if (seeded) limits.seed(structuredClone(SEED_LIMITS))
  }
  apply()

  const widget = async (): Promise<UsageWidgetData> => {
    const rows = scenario === 'default' ? [] : ROWS
    const lim = await limits.get()
    const list = lim.ok ? lim.value : []
    const providers: ProviderUsageView[] = (scenario === 'default' ? [] : PROVIDER_CLI_IDS).map(
      (provider) => {
        const totals = sum(
          rows.filter((r) => r.provider === provider),
          scale
        )
        const l = list.find((x) => x.provider === provider)
        const percent =
          l && totals.costUsd !== null ? Math.round((totals.costUsd / l.amount) * 1000) / 10 : null
        const status: ProviderUsageView['status'] = !l
          ? 'no-limit'
          : percent === null
            ? 'unknown'
            : percent >= 100
              ? 'exceeded'
              : percent >= settings.warnPercent
                ? 'warn'
                : 'ok'
        return {
          provider,
          totals,
          unit: l?.unit ?? null,
          limitAmount: l?.amount ?? null,
          percent,
          estimated: l?.unit === 'subscription-percent',
          costKrw:
            l?.unit === 'usd' && totals.costUsd !== null
              ? totals.costUsd * settings.krwPerUsd
              : null,
          status
        }
      }
    )
    return {
      windowStart: '2026-11-09T00:00:00.000Z',
      windowEnd: '2026-11-16T00:00:00.000Z',
      settings: { ...settings },
      providers,
      byProject: breakdown(rows, (r) => r.project, scale),
      byEmployee: breakdown(rows, (r) => r.employee, scale),
      total: sum(rows, scale)
    }
  }

  const api: Mock = {
    getUsageWidget: async () => {
      await wait()
      if (scenario === 'loading') return new Promise<never>(() => {})
      if (scenario === 'error') {
        return { ok: false, code: 'internal', message: '사용량을 읽지 못했습니다.' }
      }
      return { ok: true, value: await widget() }
    },
    getUsageSettings: async () => ({ ok: true, value: { ...settings } }),
    saveUsageSettings: async (req) => {
      await wait()
      if (!validateUsageSettings(req)) {
        return { ok: false, code: 'invalid-request', message: '설정 값이 올바르지 않습니다.' }
      }
      settings = { ...req }
      return { ok: true, value: { ...settings } }
    },
    getProviderSelection: async () => ({ ok: true, value: structuredClone(selection) }),
    saveProviderSelection: async (req) => {
      await wait()
      const entries = Object.entries(req.overrides ?? {})
      if (
        !isProviderCliIdValue(req.defaultProvider) ||
        entries.length > MAX_PROVIDER_OVERRIDES ||
        entries.some(([k, v]) => k.length === 0 || k.length > 64 || !isProviderCliIdValue(v))
      ) {
        return { ok: false, code: 'invalid-request', message: '제공자 선택이 올바르지 않습니다.' }
      }
      selection = structuredClone(req)
      return { ok: true, value: structuredClone(selection) }
    }
  }

  return {
    api,
    reset: () => {
      settings = { ...USAGE_SETTINGS_DEFAULT }
      selection = { defaultProvider: DEFAULT_PROVIDER, overrides: {} }
      apply()
    }
  }
}
