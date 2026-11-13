import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { UsageWidgetData } from '../../../shared/usage'
import { USAGE_SETTINGS_DEFAULT } from '../../../shared/usage'
import { BreakdownSection } from './BreakdownSection'
import { SettingsView } from './SettingsView'
import { UsageSection } from './UsageSection'
import { ProvidersSection } from './ProvidersSection'

const empty = {
  requests: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  costUsd: null
}
const widget = (over: Partial<UsageWidgetData> = {}): UsageWidgetData => ({
  windowStart: '2026-11-09T00:00:00.000Z',
  windowEnd: '2026-11-16T00:00:00.000Z',
  settings: { ...USAGE_SETTINGS_DEFAULT },
  providers: [],
  byProject: [],
  byEmployee: [],
  total: empty,
  ...over
})
const names = {
  projectNames: new Map<string, string>(),
  employeeNames: new Map<string, string>(),
  employeeProjects: new Map<string, string[]>()
}

describe('SettingsView', () => {
  it('starts in the loading state', () => {
    const html = renderToStaticMarkup(<SettingsView />)
    expect(html).toContain('불러오고 있어요')
    expect(html).toContain('설정·예산')
  })
})

describe('UsageSection', () => {
  it('shows an empty state without providers', () => {
    expect(renderToStaticMarkup(<UsageSection widget={widget()} />)).toContain(
      '아직 기록된 사용량이 없어요'
    )
  })
  it('renders a progressbar with an accessible label, and unknown/no-limit guidance', () => {
    const html = renderToStaticMarkup(
      <UsageSection
        widget={widget({
          providers: [
            {
              provider: 'claude',
              totals: { ...empty, requests: 4, costUsd: 30 },
              unit: 'usd',
              limitAmount: 20,
              percent: 150,
              estimated: false,
              costKrw: 42000,
              status: 'exceeded'
            },
            {
              provider: 'gemini',
              totals: { ...empty, requests: 2 },
              unit: null,
              limitAmount: null,
              percent: null,
              estimated: false,
              costKrw: null,
              status: 'no-limit'
            }
          ]
        })}
      />
    )
    expect(html).toContain('role="progressbar"')
    expect(html).toContain('Claude 사용률')
    expect(html).toContain('한도 초과')
    expect(html).toContain('한도 미설정')
  })
})

describe('BreakdownSection', () => {
  it('says unknown instead of inventing attribution', () => {
    const html = renderToStaticMarkup(
      <BreakdownSection widget={widget({ total: { ...empty, requests: 5 } })} names={names} />
    )
    expect(html).toContain('알 수 없음')
    expect(html).not.toContain('<table')
  })
  it('renders tables with the common and unclassified rows', () => {
    const t = { ...empty, requests: 1, costUsd: 2 }
    const html = renderToStaticMarkup(
      <BreakdownSection
        widget={widget({
          total: t,
          byProject: [{ key: null, totals: t }],
          byEmployee: [{ key: null, totals: t }]
        })}
        names={names}
      />
    )
    expect(html).toContain('회사 공통')
    expect(html).toContain('미분류')
    expect(html).toContain('scope="col"')
  })
})

describe('ProvidersSection', () => {
  it('warns about usage cost for the connection test and has no key input', () => {
    const html = renderToStaticMarkup(
      <ProvidersSection
        selection={{ defaultProvider: 'claude', overrides: {} }}
        detection={{ kind: 'ready', items: [] }}
        onRecheck={() => {}}
        onSaved={() => {}}
      />
    )
    expect(html).toContain('사용량이 조금 쓰일 수 있어요')
    expect(html).toContain('CLI 연결 다시 확인')
    expect(html).not.toMatch(/type="(text|password)"/)
  })
  it('explains a failed selection load', () => {
    const html = renderToStaticMarkup(
      <ProvidersSection
        selection={null}
        detection={{ kind: 'error', message: '확인하지 못했어요' }}
        onRecheck={() => {}}
        onSaved={() => {}}
      />
    )
    expect(html).toContain('제공자 선택을 불러오지 못했어요')
    expect(html).toContain('확인하지 못했어요')
  })
})
