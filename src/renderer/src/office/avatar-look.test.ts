import { describe, expect, it } from 'vitest'
import { hashTitle, lookFor, shortLabel } from './avatar-look'
import { parseCssColor } from './palette'

describe('lookFor', () => {
  it('is stable and within the allowed ranges', () => {
    for (const t of ['CEO', 'COO', '개발자', 'UI 개발자', '', '😀']) {
      const l = lookFor(t)
      expect(l).toEqual(lookFor(t))
      expect([1, 2, 3]).toContain(l.skin)
      expect([1, 2, 3]).toContain(l.hair)
      expect([0, 1]).toContain(l.style)
    }
  })
  it('varies across titles', () => {
    const looks = new Set(
      Array.from({ length: 30 }, (_, i) => JSON.stringify(lookFor(`직원 ${i}`)))
    )
    expect(looks.size).toBeGreaterThan(3)
    expect(hashTitle('a')).not.toBe(hashTitle('b'))
  })
})

describe('shortLabel', () => {
  it('keeps short names and truncates long ones by characters', () => {
    expect(shortLabel('UI 개발자')).toBe('UI 개발자')
    expect(shortLabel('프론트엔드 개발자 팀장', 7)).toBe('프론트엔드 …')
    expect([...shortLabel('가'.repeat(30), 7)]).toHaveLength(7)
  })
})

describe('parseCssColor', () => {
  it('parses #rgb and #rrggbb with whitespace', () => {
    expect(parseCssColor(' #1f1a2b ')).toBe(0x1f1a2b)
    expect(parseCssColor('#fa0')).toBe(0xffaa00)
  })
  it('rejects anything else', () => {
    for (const v of ['', 'red', 'rgb(0,0,0)', '#12', '#1234567', 'url(x)']) {
      expect(parseCssColor(v)).toBeNull()
    }
  })
})
