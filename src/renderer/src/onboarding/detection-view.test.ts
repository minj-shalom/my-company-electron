import { describe, expect, it } from 'vitest'
import { providerBadge } from './detection-view'

describe('providerBadge', () => {
  it('shows loading before anything else', () => {
    expect(providerBadge(null, true)).toEqual({ label: '확인 중…', tone: 'neutral' })
  })
  it('shows unknown when there is no detection result', () => {
    expect(providerBadge(null, false)).toEqual({ label: '확인 못 함', tone: 'neutral' })
  })
  it('includes the version only for installed providers', () => {
    expect(
      providerBadge({ provider: 'claude', state: 'ok', version: '1.0.0', message: '' }, false)
    ).toEqual({ label: '설치됨 (1.0.0)', tone: 'good' })
    expect(
      providerBadge(
        { provider: 'codex', state: 'not-installed', version: null, message: '' },
        false
      )
    ).toEqual({ label: '설치되지 않음', tone: 'warn' })
  })
})
