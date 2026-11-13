import type { UsageSettings } from '../../shared/usage'

export interface UsageWindow {
  start: Date
  end: Date
}

/**
 * 주간 집계 구간 [start, end). 초기화 시점(요일·시각, 로컬 시간)이 지날 때마다 새 구간이 시작되어 집계가 0에서 다시 시작한다.
 * 서머타임 전환 주에도 로컬 달력 기준으로 7일씩 건너뛴다.
 */
export function weekWindow(
  now: Date,
  s: Pick<UsageSettings, 'resetWeekday' | 'resetHour'>
): UsageWindow {
  const start = new Date(now)
  start.setHours(s.resetHour, 0, 0, 0)
  const back = (start.getDay() - s.resetWeekday + 7) % 7
  start.setDate(start.getDate() - back)
  if (start.getTime() > now.getTime()) start.setDate(start.getDate() - 7)
  const end = new Date(start)
  end.setDate(end.getDate() + 7)
  return { start, end }
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** 기록 파일 이름에 쓰는 로컬 날짜. */
export function localDay(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
