import { describe, expect, it } from 'vitest'
import { createSafeLogger, REDACTED, SecretRegistry } from './redact'

describe('redaction', () => {
  it('masks registered values everywhere in a line', () => {
    const r = new SecretRegistry()
    r.register('super-secret-value-1')
    const lines: string[] = []
    const log = createSafeLogger((l) => lines.push(l), r)
    log.log('token', 'super-secret-value-1', { nested: 'x super-secret-value-1 y' })
    log.error('failed super-secret-value-1', new Error('super-secret-value-1'))
    expect(lines.join('\n')).not.toContain('super-secret-value-1')
    expect(lines.join('\n')).toContain(REDACTED)
  })

  it('masks common token shapes without knowing the value', () => {
    const r = new SecretRegistry()
    const out = r.mask(
      'Authorization: Bearer abcdef123456 access_token=zzzzzzzz1 {"refresh_token":"qqqqqqqq2"} eyJhbGciOiJI.eyJzdWIiOiIx.c2lnbmF0dXJl'
    )
    for (const leaked of ['abcdef123456', 'zzzzzzzz1', 'qqqqqqqq2', 'eyJhbGciOiJI', 'c2lnbmF0dXJl'])
      expect(out).not.toContain(leaked)
  })

  it('leaves unrelated text untouched', () => {
    expect(new SecretRegistry().mask('hello 글 게시')).toBe('hello 글 게시')
  })
})
