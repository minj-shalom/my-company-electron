import { describe, expect, it } from 'vitest'
import { parseLimitInput } from './weekly-limit'

describe('parseLimitInput', () => {
  it('treats blank as no limit', () => {
    expect(parseLimitInput('  ')).toEqual({ ok: true, amount: null })
  })
  it('accepts integers, decimals and thousands separators', () => {
    expect(parseLimitInput('20')).toEqual({ ok: true, amount: 20 })
    expect(parseLimitInput('12.5')).toEqual({ ok: true, amount: 12.5 })
    expect(parseLimitInput('1,000')).toEqual({ ok: true, amount: 1000 })
    expect(parseLimitInput('1,234,567.5')).toMatchObject({ ok: false }) // 상한 초과
    expect(parseLimitInput('0.5')).toEqual({ ok: true, amount: 0.5 })
  })
  it.each([
    'abc',
    '-5',
    '1e3',
    '0x10',
    '1.234',
    'sk-ant-secret',
    '$5',
    '5 달러',
    '1,5',
    '1,0,0',
    '1,00',
    ',100',
    '007',
    '00',
    '01.5'
  ])('rejects %s', (v) => {
    expect(parseLimitInput(v)).toMatchObject({ ok: false })
  })
  it('rejects zero and values over the maximum', () => {
    expect(parseLimitInput('0')).toMatchObject({ ok: false })
    expect(parseLimitInput('100000')).toEqual({ ok: true, amount: 100000 })
    expect(parseLimitInput('100001')).toMatchObject({ ok: false })
  })
})
