/** CFO 사용량 기록·집계 타입 (main/preload/renderer 공용). 인증·토큰(자격 증명) 값을 담는 필드는 없다. */

import type { ProviderCliId, WeeklyLimitUnit } from './provider'

/** 기록 한 건. 귀속 필드가 null이면 각각 "회사 공통"(project), "미분류"(employee, ticket)다. 값을 추정해 채우지 않는다. */
export interface UsageRecord {
  /** 스키마 버전. */
  v: 1
  /** 기록 시각(ISO 8601, UTC). */
  at: string
  provider: ProviderCliId
  /** T-037 프로젝트의 안정 id. 이름 수정·보관과 무관하게 유지된다. null = 회사 공통. */
  project: string | null
  /** 직원 id. null = 미분류. */
  employee: string | null
  /** 티켓 번호(T-NNN). null = 미분류. */
  ticket: string | null
  /** 이 기록이 센 요청(실행 결과) 수. */
  requests: number
  /** CLI가 알려 준 달러 비용. 알려 주지 않으면 null (0으로 채우지 않는다). */
  costUsd: number | null
  inputTokens: number | null
  outputTokens: number | null
  cacheReadTokens: number | null
  cacheCreationTokens: number | null
  durationMs: number | null
}

export const USAGE_WARN_PERCENT_DEFAULT = 80
export const USAGE_KRW_PER_USD_DEFAULT = 1400

/** 사용량 설정. 환율은 사용자가 입력하며 네트워크로 조회하지 않는다. 초기화 시점은 이 기기의 로컬 시간 기준이다. */
export interface UsageSettings {
  /** 경고 기준(%), 1~100 정수. */
  warnPercent: number
  /** 1달러당 원화, 1~100000. */
  krwPerUsd: number
  /** 주간 한도가 초기화되는 요일 (0=일 ... 6=토). */
  resetWeekday: number
  /** 초기화 시각(0~23시). */
  resetHour: number
}

export const USAGE_SETTINGS_DEFAULT: UsageSettings = {
  warnPercent: USAGE_WARN_PERCENT_DEFAULT,
  krwPerUsd: USAGE_KRW_PER_USD_DEFAULT,
  resetWeekday: 1,
  resetHour: 0
}

/** 요청 수·토큰 수는 요금제와 무관하게 항상 보여 주는 지표다. costUsd는 알려 준 기록이 하나도 없으면 null (알 수 없음). */
export interface UsageTotals {
  requests: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  costUsd: number | null
}

export type UsageLimitStatus =
  | 'ok'
  | 'warn' // 경고 기준 이상
  | 'exceeded' // 100% 이상
  | 'no-limit' // 이 제공자의 한도를 입력하지 않음
  | 'unknown' // 한도는 있으나 CLI가 비용을 알려 주지 않아 사용률을 계산할 수 없음

export interface ProviderUsageView {
  provider: ProviderCliId
  totals: UsageTotals
  /** 한도 단위(= 사용자가 고른 요금제). 한도가 없으면 null. */
  unit: WeeklyLimitUnit | null
  limitAmount: number | null
  /** 사용률(%). 계산할 수 없으면 null. */
  percent: number | null
  /** 구독제의 사용률은 사용자 입력 기준값 대비 추정치다. */
  estimated: boolean
  /** 종량제(`usd`)일 때 한화 환산 비용. 그 외 null. */
  costKrw: number | null
  status: UsageLimitStatus
}

export interface UsageBreakdownItem {
  /** project: 프로젝트 id / employee: 직원 id. null은 각각 회사 공통, 미분류. */
  key: string | null
  totals: UsageTotals
}

/** 사용량 위젯 데이터 (화면은 T-038). 집계는 회사 단위 합계이며 주간 구간은 [windowStart, windowEnd)다. */
export interface UsageWidgetData {
  windowStart: string
  windowEnd: string
  settings: UsageSettings
  providers: ProviderUsageView[]
  byProject: UsageBreakdownItem[]
  byEmployee: UsageBreakdownItem[]
  total: UsageTotals
}

export function validateUsageSettings(v: unknown): v is UsageSettings {
  if (typeof v !== 'object' || v === null) return false
  const s = v as Record<string, unknown>
  const int = (x: unknown, min: number, max: number): boolean =>
    typeof x === 'number' && Number.isInteger(x) && x >= min && x <= max
  return (
    int(s.warnPercent, 1, 100) &&
    typeof s.krwPerUsd === 'number' &&
    Number.isFinite(s.krwPerUsd) &&
    s.krwPerUsd >= 1 &&
    s.krwPerUsd <= 100_000 &&
    int(s.resetWeekday, 0, 6) &&
    int(s.resetHour, 0, 23)
  )
}
