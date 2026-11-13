import { WEEKDAY_CHARS, type RecurringCadence, type WeekdayChar } from '../../shared/recurring'

/** 날짜·요일 계산의 시간대. undefined면 이 컴퓨터의 시간대. 테스트에서 경계를 고정하려고 주입한다. */
export interface DayClock {
  now: () => Date
  timeZone?: string
}

export interface DayInfo {
  /** YYYY-MM-DD */
  date: string
  /** 일=0. */
  weekday: number
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6
}

export function dayOf(at: Date, timeZone?: string): DayInfo {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hourCycle: 'h23'
  }).formatToParts(at)
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? ''
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    weekday: WEEKDAY_INDEX[get('weekday')] ?? 0
  }
}

export function parseCadence(v: string): RecurringCadence | null {
  const t = v.trim()
  if (t === 'daily' || t === 'weekdays') return t
  const m = /^weekly:(.)$/.exec(t)
  if (m && (WEEKDAY_CHARS as readonly string[]).includes(m[1]))
    return `weekly:${m[1] as WeekdayChar}`
  return null
}

export function matchesCadence(cadence: RecurringCadence, weekday: number): boolean {
  if (cadence === 'daily') return true
  if (cadence === 'weekdays') return weekday >= 1 && weekday <= 5
  return WEEKDAY_CHARS.indexOf(cadence.slice('weekly:'.length) as WeekdayChar) === weekday
}

/**
 * 제목·목표·완료 조건 템플릿 치환. `{date}`만 바꾸고 다른 `{...}`, `$`, 백슬래시는 해석하지 않는다.
 * 치환값은 형식이 고정된 날짜라서 결과에 줄 구조를 바꾸는 문자가 들어가지 않는다.
 */
export function renderTemplate(template: string, date: string): string {
  return template.split('{date}').join(date)
}

const HOUR = 3_600_000
const MINUTE = 60_000

/** 시간대 기준 다음 날 0시(epoch ms). 시간 단위로 날짜가 바뀌는 곳을 찾고 분 단위로 좁힌다. */
function nextMidnight(from: Date, timeZone?: string): number {
  const today = dayOf(from, timeZone).date
  let t = from.getTime()
  while (dayOf(new Date(t), timeZone).date === today) t += HOUR
  for (let back = 0; back < 60; back++) {
    if (dayOf(new Date(t - MINUTE), timeZone).date === today) break
    t -= MINUTE
  }
  return t
}

/**
 * 다음 생성 예정 시각. 오늘이 해당 요일이고 아직 안 만들었으면 지금(다음 틱), 아니면 다음 해당 요일 0시.
 * 실제 생성은 그 시각 이후 첫 스케줄러 틱에서 일어난다.
 */
export function nextRunAt(
  cadence: RecurringCadence,
  createdToday: boolean,
  now: Date,
  timeZone?: string
): number {
  const today = dayOf(now, timeZone)
  if (!createdToday && matchesCadence(cadence, today.weekday)) return now.getTime()
  let t = now.getTime()
  for (let i = 0; i < 8; i++) {
    t = nextMidnight(new Date(t), timeZone)
    if (matchesCadence(cadence, dayOf(new Date(t), timeZone).weekday)) return t
  }
  return t
}
