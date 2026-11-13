import {
  SCHEDULE_MAX_INTERVAL_MINUTES,
  SCHEDULE_MIN_INTERVAL_MINUTES
} from '../../shared/scheduler'

export const SCHEDULE_PATH = 'company/schedule.md'
const MAX_SCHEDULE_BYTES = 16 * 1024

export const DEFAULT_INTERVAL_MINUTES = 180
export const DEFAULT_ACTIVE_HOURS = '09:00-22:00'

export interface ScheduleConfig {
  enabled: boolean
  intervalMinutes: number
  activeHours: string
}

export interface ParsedSchedule {
  config: ScheduleConfig
  warnings: string[]
}

/** 파일이 없거나 읽을 수 없으면 꺼진 상태다 (자동 실행은 명시적으로 켠 경우에만). */
export const DISABLED_SCHEDULE: ScheduleConfig = {
  enabled: false,
  intervalMinutes: DEFAULT_INTERVAL_MINUTES,
  activeHours: DEFAULT_ACTIVE_HOURS
}

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/

/** `HH:MM-HH:MM`을 분 단위 구간으로 바꾼다. 시작과 끝이 같거나 형식이 틀리면 null. */
export function parseTimeRange(text: string): { start: number; end: number } | null {
  const m = /^(\d{2}:\d{2})-(\d{2}:\d{2})$/.exec(text)
  if (!m) return null
  const a = TIME.exec(m[1])
  const b = TIME.exec(m[2])
  if (!a || !b) return null
  const start = Number(a[1]) * 60 + Number(a[2])
  const end = Number(b[1]) * 60 + Number(b[2])
  return start === end ? null : { start, end }
}

/**
 * `- 키: 값` 줄만 읽는다. 잘못된 값은 안전한 쪽으로 대체하고 경고를 남긴다:
 * enabled는 `true`가 아니면 꺼짐, 간격·활동 시간은 기본값. 같은 키가 반복되면 처음 값만 쓴다.
 */
export function parseSchedule(text: string | null): ParsedSchedule {
  const warnings: string[] = []
  if (text === null) return { config: { ...DISABLED_SCHEDULE }, warnings }
  if (Buffer.byteLength(text, 'utf8') > MAX_SCHEDULE_BYTES) {
    return {
      config: { ...DISABLED_SCHEDULE },
      warnings: ['스케줄 파일이 너무 커서 읽지 않았어요. 자동 실행은 꺼진 상태예요.']
    }
  }
  const seen = new Map<string, string>()
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*-\s*([a-z_]+)\s*:\s*(.*?)\s*$/.exec(line)
    if (!m) continue
    if (seen.has(m[1])) {
      warnings.push(`${m[1]} 항목이 중복되어 처음 값만 사용해요.`)
      continue
    }
    seen.set(m[1], m[2])
  }

  const config: ScheduleConfig = { ...DISABLED_SCHEDULE }

  const enabled = seen.get('enabled')
  if (enabled === 'true') config.enabled = true
  else if (enabled !== undefined && enabled !== 'false')
    warnings.push('enabled 값이 올바르지 않아 꺼진 상태로 둬요.')

  const interval = seen.get('interval_minutes')
  if (interval !== undefined) {
    const n = /^\d{1,5}$/.test(interval) ? Number(interval) : NaN
    if (n >= SCHEDULE_MIN_INTERVAL_MINUTES && n <= SCHEDULE_MAX_INTERVAL_MINUTES)
      config.intervalMinutes = n
    else
      warnings.push(
        `interval_minutes는 ${SCHEDULE_MIN_INTERVAL_MINUTES}~${SCHEDULE_MAX_INTERVAL_MINUTES}분이어야 해서 기본값(${DEFAULT_INTERVAL_MINUTES}분)을 써요.`
      )
  }

  const hours = seen.get('active_hours')
  if (hours !== undefined) {
    if (parseTimeRange(hours) !== null) config.activeHours = hours
    else warnings.push(`active_hours 형식이 올바르지 않아 기본값(${DEFAULT_ACTIVE_HOURS})을 써요.`)
  }
  return { config, warnings }
}
