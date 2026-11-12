import { describe, expect, it } from 'vitest'
import { WEEKLY_LIMIT_MAX, validateWeeklyLimitAmount } from './provider'

describe('validateWeeklyLimitAmount', () => {
  it.each([NaN, Infinity, -Infinity, 0, -0, -1, -0.01, Number.MIN_VALUE, Number.MAX_VALUE])(
    'rejects number %s',
    (v) => expect(validateWeeklyLimitAmount(v)).toBe(false)
  )
  it.each(['1e3', ' 5', '05', '5', '', '0x10'])('rejects string %j', (v) =>
    expect(validateWeeklyLimitAmount(v)).toBe(false)
  )
  it.each([null, undefined, {}, [], [5], true, 5n, () => 5, new Number(5)])(
    'rejects non-number %s',
    (v) => expect(validateWeeklyLimitAmount(v)).toBe(false)
  )
  it('enforces the upper bound', () => {
    expect(WEEKLY_LIMIT_MAX).toBe(100000)
    expect(validateWeeklyLimitAmount(100000)).toBe(true)
    expect(validateWeeklyLimitAmount(100000.01)).toBe(false)
    expect(validateWeeklyLimitAmount(100001)).toBe(false)
  })
  it('allows up to two decimal places only', () => {
    for (const v of [0.01, 0.5, 1, 19.99, 12.5, 99999.99]) {
      expect(validateWeeklyLimitAmount(v)).toBe(true)
    }
    for (const v of [1.005, 0.001, 19.999]) {
      expect(validateWeeklyLimitAmount(v)).toBe(false)
    }
  })
  it('tolerates floating point representation error of valid cents', () => {
    expect(validateWeeklyLimitAmount(0.1 + 0.2)).toBe(true)
    expect(validateWeeklyLimitAmount(1.1 * 3)).toBe(true)
  })
})
