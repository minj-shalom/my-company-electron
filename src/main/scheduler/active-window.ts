import { parseTimeRange } from './schedule-config'

/** 요일 번호는 `Date.getDay()`와 같다 (일=0). */
export interface ActiveWindow {
  /** 비어 있으면 매일. */
  days: ReadonlySet<number>
  start: number
  end: number
}

const DAY_CHARS = '일월화수목금토'
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]

function parseDays(text: string): Set<number> | null {
  const t = text.trim()
  if (t === '' || t === '매일') return new Set(ALL_DAYS)
  if (t === '평일') return new Set([1, 2, 3, 4, 5])
  if (t === '주말') return new Set([0, 6])
  const out = new Set<number>()
  for (const part of t.split(/[,\s]+/).filter(Boolean)) {
    const range = /^(.)-(.)$/.exec(part)
    if (range) {
      const a = DAY_CHARS.indexOf(range[1])
      const b = DAY_CHARS.indexOf(range[2])
      if (a < 0 || b < 0) return null
      // 월-일처럼 주를 넘어가는 구간도 허용한다.
      for (let d = a; ; d = (d + 1) % 7) {
        out.add(d)
        if (d === b) break
      }
    } else if (part.length === 1 && DAY_CHARS.includes(part)) {
      out.add(DAY_CHARS.indexOf(part))
    } else return null
  }
  return out.size > 0 ? out : null
}

/**
 * 프로젝트 정책(T-047)의 `활동 요일·시간` 자유 텍스트를 해석한다. 예: `월-금 09:00-18:00`, `평일`, `10:00-12:00`.
 * 해석할 수 없으면 null이고, 호출자는 이 값으로 회사 활동 시간을 더 좁히지 못한다.
 */
export function parsePolicyHours(text: string): ActiveWindow | null {
  const m = /^(.*?)\s*(\d{2}:\d{2}-\d{2}:\d{2})?$/.exec(text.trim())
  if (!m) return null
  const days = parseDays(m[1])
  if (days === null) return null
  if (m[2] === undefined) return m[1].trim() === '' ? null : { days, start: 0, end: 24 * 60 }
  const range = parseTimeRange(m[2])
  return range === null ? null : { days, ...range }
}

/** 자정을 넘기는 구간(22:00-02:00)은 시작한 날의 요일로 센다. */
export function isWithinWindow(now: Date, w: ActiveWindow): boolean {
  const minute = now.getHours() * 60 + now.getMinutes()
  const day = now.getDay()
  if (w.start < w.end) return w.days.has(day) && minute >= w.start && minute < w.end
  if (minute >= w.start) return w.days.has(day)
  return w.days.has((day + 6) % 7) && minute < w.end
}

export function isWithinCompanyHours(now: Date, activeHours: string): boolean {
  const r = parseTimeRange(activeHours)
  if (r === null) return false
  return isWithinWindow(now, { days: new Set(ALL_DAYS), ...r })
}
