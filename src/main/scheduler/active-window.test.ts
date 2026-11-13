import { describe, expect, it } from 'vitest'
import { isWithinCompanyHours, isWithinWindow, parsePolicyHours } from './active-window'

// 2026-11-16은 월요일 (로컬 시간 기준 생성).
const at = (day: number, h: number, m = 0): Date => new Date(2026, 10, 15 + day, h, m)

describe('company hours', () => {
  it('handles a daytime range', () => {
    expect(isWithinCompanyHours(at(1, 9), '09:00-22:00')).toBe(true)
    expect(isWithinCompanyHours(at(1, 22), '09:00-22:00')).toBe(false)
    expect(isWithinCompanyHours(at(1, 8, 59), '09:00-22:00')).toBe(false)
  })
  it('handles ranges that cross midnight', () => {
    expect(isWithinCompanyHours(at(1, 23), '22:00-06:00')).toBe(true)
    expect(isWithinCompanyHours(at(1, 5), '22:00-06:00')).toBe(true)
    expect(isWithinCompanyHours(at(1, 12), '22:00-06:00')).toBe(false)
  })
  it('is closed for an invalid range', () => {
    expect(isWithinCompanyHours(at(1, 12), 'bad')).toBe(false)
  })
})

describe('policy hours', () => {
  it('parses days and time', () => {
    const w = parsePolicyHours('월-금 09:00-18:00')
    expect(w).not.toBeNull()
    expect(isWithinWindow(at(1, 10), w!)).toBe(true)
    expect(isWithinWindow(at(6, 10), w!)).toBe(false) // 토요일
    expect(isWithinWindow(at(1, 19), w!)).toBe(false)
  })
  it('supports keywords, lists and day-only values', () => {
    expect(isWithinWindow(at(0, 3), parsePolicyHours('주말')!)).toBe(true) // 일요일
    expect(isWithinWindow(at(2, 3), parsePolicyHours('월,수')!)).toBe(false) // 화요일
    expect(isWithinWindow(at(3, 3), parsePolicyHours('월,수')!)).toBe(true)
    expect(isWithinWindow(at(1, 3), parsePolicyHours('10:00-12:00')!)).toBe(false)
  })
  it('counts a midnight-crossing range by its start day', () => {
    const w = parsePolicyHours('금 22:00-02:00')!
    expect(isWithinWindow(at(5, 23), w)).toBe(true)
    expect(isWithinWindow(at(6, 1), w)).toBe(true) // 토요일 새벽
    expect(isWithinWindow(at(5, 1), w)).toBe(false) // 금요일 새벽은 목요일 시작분
  })
  it('returns null for free text it cannot read', () => {
    expect(parsePolicyHours('오전에만')).toBeNull()
    expect(parsePolicyHours('')).toBeNull()
    expect(parsePolicyHours('월-금 99:00-18:00')).toBeNull()
  })
})
