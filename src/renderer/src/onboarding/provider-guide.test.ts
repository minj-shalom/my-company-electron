import { describe, expect, it } from 'vitest'
import { PROVIDER_CLI_IDS } from '../../../shared/provider'
import { detectView } from './detection-view'
import { PROVIDER_GUIDES, guessOs } from './provider-guide'

describe('provider guides', () => {
  it('covers every provider exactly once with commands for both OS kinds', () => {
    expect(PROVIDER_GUIDES.map((g) => g.id).sort()).toEqual([...PROVIDER_CLI_IDS].sort())
    for (const g of PROVIDER_GUIDES) {
      expect(g.install.unix.length).toBeGreaterThan(0)
      expect(g.install.windows.length).toBeGreaterThan(0)
      expect(g.docsUrl).toMatch(/^https:\/\//)
    }
  })
  it('uses the login command equal to the CLI id', () => {
    for (const g of PROVIDER_GUIDES) expect(g.loginCommand).toBe(g.id)
  })
  it('guesses the OS', () => {
    expect(guessOs('Mozilla/5.0 (Windows NT 10.0; Win64)')).toBe('windows')
    expect(guessOs('Mozilla/5.0 (Macintosh; Intel Mac OS X)')).toBe('unix')
  })
  it('maps every detect state to a label', () => {
    expect(detectView('ok').label).toBe('설치됨')
    expect(detectView('not-installed').label).toBe('설치되지 않음')
    expect(detectView('exec-failed').label).toBe('실행 실패')
    expect(detectView('timeout').label).toBe('응답 없음')
  })
})
