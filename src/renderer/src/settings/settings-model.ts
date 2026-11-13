import type { WindowApi } from '../../../shared/api'
import {
  PROVIDER_CLI_IDS,
  type ProviderCliId,
  type WeeklyLimit,
  type WeeklyLimitUnit
} from '../../../shared/provider'
import { isProviderCliIdValue, type ProviderSelection } from '../../../shared/provider-selection'
import type {
  ProviderUsageView,
  UsageBreakdownItem,
  UsageSettings,
  UsageTotals
} from '../../../shared/usage'
import { COMPANY_COMMON_TEXT, UNCLASSIFIED_TEXT, UNKNOWN_TEXT } from './limit-wording'

export type ParseResult = { ok: true; value: number } | { ok: false; message: string }

/** 숫자 외 문자(토큰·키처럼 보이는 문자열 포함)는 모두 거부한다. */
const DIGITS = /^\d+$/

export function parseWarnPercent(text: string): ParseResult {
  const t = text.trim()
  const n = DIGITS.test(t) ? Number(t) : NaN
  return n >= 1 && n <= 100
    ? { ok: true, value: n }
    : { ok: false, message: '1에서 100 사이의 정수를 입력해 주세요.' }
}

export function parseKrwPerUsd(text: string): ParseResult {
  const t = text.trim().replace(/,/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(t)) {
    return { ok: false, message: '숫자만 입력해 주세요. 예: 1400' }
  }
  const n = Number(t)
  return n >= 1 && n <= 100_000
    ? { ok: true, value: n }
    : { ok: false, message: '1 이상 100,000 이하로 입력해 주세요.' }
}

export const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'] as const

export function formatReset(s: Pick<UsageSettings, 'resetWeekday' | 'resetHour'>): string {
  return `매주 ${WEEKDAY_LABELS[s.resetWeekday]}요일 ${s.resetHour}시`
}

export const formatUsd = (v: number): string =>
  `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
export const formatKrw = (v: number): string => `${Math.round(v).toLocaleString('ko-KR')}원`
export const formatCount = (v: number): string => v.toLocaleString('ko-KR')

export function tokenTotal(t: UsageTotals): number {
  return t.inputTokens + t.outputTokens + t.cacheReadTokens + t.cacheCreationTokens
}

export function formatWindow(startIso: string, endIso: string): string {
  const fmt = (iso: string): string => {
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? UNKNOWN_TEXT : `${d.getMonth() + 1}월 ${d.getDate()}일`
  }
  return `${fmt(startIso)} ~ ${fmt(endIso)}`
}

export type BarTone = 'good' | 'warn' | 'bad' | 'neutral'

export interface UsageRowView {
  provider: ProviderCliId
  /** 막대 길이(0~100). 사용률을 모르면 null. */
  barPercent: number | null
  percentText: string
  tone: BarTone
  statusText: string
  note: string | null
  costText: string
  requestsText: string
  tokensText: string
}

export function usageRow(v: ProviderUsageView, krwPerUsd: number): UsageRowView {
  const cost =
    v.totals.costUsd === null
      ? UNKNOWN_TEXT
      : v.unit === 'usd'
        ? `${formatUsd(v.totals.costUsd)} (${formatKrw(v.costKrw ?? v.totals.costUsd * krwPerUsd)})`
        : formatUsd(v.totals.costUsd)
  const base = {
    provider: v.provider,
    costText: cost,
    requestsText: `${formatCount(v.totals.requests)}회`,
    tokensText: `${formatCount(tokenTotal(v.totals))}개`
  }
  switch (v.status) {
    case 'no-limit':
      return {
        ...base,
        barPercent: null,
        percentText: '한도 미설정',
        tone: 'neutral',
        statusText: '한도 없음',
        note: '아래 "주간 한도"에서 요금제와 금액을 입력하면 사용률을 볼 수 있어요.'
      }
    case 'unknown':
      return {
        ...base,
        barPercent: null,
        percentText: UNKNOWN_TEXT,
        tone: 'neutral',
        statusText: '사용률 알 수 없음',
        note: 'CLI가 비용을 알려 주지 않아 사용률을 계산할 수 없어요. 요청 수와 토큰 수는 정확해요.'
      }
    default: {
      const pct = v.percent ?? 0
      const tone: BarTone = v.status === 'exceeded' ? 'bad' : v.status === 'warn' ? 'warn' : 'good'
      return {
        ...base,
        barPercent: Math.min(100, Math.max(0, pct)),
        percentText: `${Math.round(pct)}%${v.estimated ? ' (추정)' : ''}`,
        tone,
        statusText: v.status === 'exceeded' ? '한도 초과' : v.status === 'warn' ? '경고' : '정상',
        note: v.estimated ? '구독 한도는 앱이 알 수 없어서, 입력한 기준값 대비 추정치예요.' : null
      }
    }
  }
}

export interface BreakdownRow {
  key: string | null
  label: string
  /** 직원 표에서만 쓴다. */
  projects: string
  costText: string
  requestsText: string
  tokensText: string
  /** 회사 합계 대비 비율. 어느 한쪽 비용을 모르면 추정하지 않고 알 수 없음. */
  ratioText: string
}

export interface BreakdownNames {
  projectNames: ReadonlyMap<string, string>
  employeeNames: ReadonlyMap<string, string>
  employeeProjects: ReadonlyMap<string, readonly string[]>
}

export function breakdownRows(
  kind: 'project' | 'employee',
  items: readonly UsageBreakdownItem[],
  total: UsageTotals,
  names: BreakdownNames
): BreakdownRow[] {
  const sorted = [...items].sort((a, b) => (b.totals.costUsd ?? -1) - (a.totals.costUsd ?? -1))
  return sorted.map((it): BreakdownRow => {
    const label =
      it.key === null
        ? kind === 'project'
          ? COMPANY_COMMON_TEXT
          : UNCLASSIFIED_TEXT
        : ((kind === 'project' ? names.projectNames : names.employeeNames).get(it.key) ?? it.key)
    const assigned = it.key === null ? undefined : names.employeeProjects.get(it.key)
    const ratio =
      it.totals.costUsd !== null && total.costUsd !== null && total.costUsd > 0
        ? `${Math.round((it.totals.costUsd / total.costUsd) * 100)}%`
        : UNKNOWN_TEXT
    return {
      key: it.key,
      label,
      projects:
        kind === 'employee'
          ? assigned && assigned.length > 0
            ? assigned.join(', ')
            : UNKNOWN_TEXT
          : '',
      costText: it.totals.costUsd === null ? UNKNOWN_TEXT : formatUsd(it.totals.costUsd),
      requestsText: `${formatCount(it.totals.requests)}회`,
      tokensText: `${formatCount(tokenTotal(it.totals))}개`,
      ratioText: ratio
    }
  })
}

/** 집계는 있는데 귀속 정보가 없는 경우다 (숫자를 추정해 채우지 않는다). */
export function attributionMissing(
  items: readonly UsageBreakdownItem[],
  total: UsageTotals
): boolean {
  return items.length === 0 && total.requests > 0
}

export const EFFECTIVE_NOTE = '변경은 다음 실행부터 적용되고, 진행 중인 실행은 그대로 이어져요.'

type SelectionApi = Pick<WindowApi, 'getProviderSelection' | 'saveProviderSelection'>
export type SelectionSave = { ok: true; value: ProviderSelection } | { ok: false }

/** 전체 교체 저장이라 저장 직전에 최신 선택을 다시 읽어 다른 변경을 덮어쓰지 않는다. */
async function updateSelection(
  api: SelectionApi,
  change: (cur: ProviderSelection) => ProviderSelection
): Promise<SelectionSave> {
  try {
    const cur = await api.getProviderSelection()
    if (!cur.ok) return { ok: false }
    const saved = await api.saveProviderSelection(change(cur.value))
    return saved.ok ? { ok: true, value: saved.value } : { ok: false }
  } catch {
    return { ok: false }
  }
}

/** provider가 null이면 회사 기본을 따른다(지정 삭제). */
export function setEmployeeProvider(
  api: SelectionApi,
  employeeId: string,
  provider: ProviderCliId | null
): Promise<SelectionSave> {
  return updateSelection(api, (cur) => {
    const overrides = { ...cur.overrides }
    if (provider === null) delete overrides[employeeId]
    else overrides[employeeId] = provider
    return { ...cur, overrides }
  })
}

export function setDefaultProvider(
  api: SelectionApi,
  provider: ProviderCliId
): Promise<SelectionSave> {
  return updateSelection(api, (cur) => ({ ...cur, defaultProvider: provider }))
}

/** 직원의 실제 제공자: 지정이 있으면 그것, 없으면 회사 기본. */
export function effectiveProvider(sel: ProviderSelection, employeeId: string): ProviderCliId {
  const o = sel.overrides[employeeId]
  return isProviderCliIdValue(o) ? o : sel.defaultProvider
}

export interface Draft {
  unit: WeeklyLimitUnit
  text: string
}
export type Drafts = Record<ProviderCliId, Draft>

const DEFAULT_UNIT: WeeklyLimitUnit = 'subscription-percent'

/** 저장된 한도로 입력 초안을 만든다. 한도가 없는 제공자는 구독제·빈 칸이다. */
export function toDrafts(limits: readonly WeeklyLimit[]): Drafts {
  const out = {} as Drafts
  for (const id of PROVIDER_CLI_IDS) {
    const l = limits.find((x) => x.provider === id)
    out[id] = l ? { unit: l.unit, text: String(l.amount) } : { unit: DEFAULT_UNIT, text: '' }
  }
  return out
}
