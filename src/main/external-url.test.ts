import { describe, expect, it } from 'vitest'
import { isAllowedAppUrl, isAllowedExternalUrl } from './external-url'

describe('isAllowedExternalUrl', () => {
  it('allows https on allowlisted hosts only', () => {
    expect(isAllowedExternalUrl('https://code.claude.com/docs/en/setup')).toBe(true)
    expect(isAllowedExternalUrl('https://github.com/x/y')).toBe(true)
  })
  it.each([
    'http://github.com/',
    'https://claude.com/',
    'https://github.com:444/x',
    'https://xn--clude-9ua.com/',
    'https://clаude.com/',
    'https://evil.com/',
    'https://github.com.evil.com/',
    'https://evil.com/github.com',
    'https://user:pw@github.com/',
    'https://sub.github.com/',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'not a url',
    ''
  ])('rejects %s', (u) => expect(isAllowedExternalUrl(u)).toBe(false))
})

describe('isAllowedAppUrl', () => {
  it('compares origins in dev', () => {
    const dev = 'http://localhost:5173'
    expect(isAllowedAppUrl('http://localhost:5173/#/x', dev)).toBe(true)
    expect(isAllowedAppUrl('http://localhost:5173.evil.com/', dev)).toBe(false)
    expect(isAllowedAppUrl('file:///x.html', dev)).toBe(false)
  })
  it('allows only file: when packaged', () => {
    expect(isAllowedAppUrl('file:///app/index.html', undefined)).toBe(true)
    expect(isAllowedAppUrl('https://claude.com', undefined)).toBe(false)
  })
})
