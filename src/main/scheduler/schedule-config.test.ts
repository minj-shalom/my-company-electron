import { describe, expect, it } from 'vitest'
import { parseSchedule, parseTimeRange } from './schedule-config'

describe('parseSchedule', () => {
  it('reads valid values', () => {
    const r = parseSchedule(
      '# 스케줄\n\n- interval_minutes: 60\n- active_hours: 22:00-06:00\n- enabled: true\n'
    )
    expect(r.config).toEqual({ enabled: true, intervalMinutes: 60, activeHours: '22:00-06:00' })
    expect(r.warnings).toEqual([])
  })
  it('is disabled when the file is missing', () => {
    expect(parseSchedule(null).config.enabled).toBe(false)
  })
  it('falls back to safe defaults for bad values', () => {
    const r = parseSchedule('- interval_minutes: 1\n- active_hours: 25:00-26:00\n- enabled: yes\n')
    expect(r.config).toEqual({ enabled: false, intervalMinutes: 180, activeHours: '09:00-22:00' })
    expect(r.warnings).toHaveLength(3)
  })
  it('rejects non-integer and huge intervals', () => {
    expect(parseSchedule('- interval_minutes: 1e3').config.intervalMinutes).toBe(180)
    expect(parseSchedule('- interval_minutes: 99999').config.intervalMinutes).toBe(180)
    expect(parseSchedule('- interval_minutes: 12.5').config.intervalMinutes).toBe(180)
  })
  it('uses the first value of a duplicated key', () => {
    const r = parseSchedule('- enabled: false\n- enabled: true\n')
    expect(r.config.enabled).toBe(false)
    expect(r.warnings).toHaveLength(1)
  })
  it('refuses oversized files', () => {
    const r = parseSchedule(`- enabled: true\n${'x'.repeat(20000)}`)
    expect(r.config.enabled).toBe(false)
  })
  it('rejects empty time ranges', () => {
    expect(parseTimeRange('09:00-09:00')).toBeNull()
  })
})
