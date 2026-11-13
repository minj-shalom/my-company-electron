import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { VisitSummary } from '../../../shared/visit'
import { mockVisitSummary } from '../mock-visit'
import { VisitNotifySection } from '../settings/VisitNotifySection'
import type { UseVisitSummary, VisitLoad } from './use-visit-summary'
import { VisitSummaryBanner } from './VisitSummaryBanner'
import { autoGroups, hasNews, pausedLabel } from './visit-model'

const empty = (over: Partial<VisitSummary> = {}): VisitSummary => ({
  ...mockVisitSummary(),
  reports: [],
  completedTickets: [],
  newDecisions: [],
  failedTicks: 0,
  killSwitch: { company: false, projects: [], updatedAt: null },
  ...over
})
const render = (load: VisitLoad, extra: Partial<UseVisitSummary> = {}): string =>
  renderToStaticMarkup(
    <VisitSummaryBanner
      visit={{
        load,
        busy: false,
        confirmError: null,
        reload: () => undefined,
        confirm: async () => undefined,
        ...extra
      }}
      onOpenDecisions={() => undefined}
    />
  )

describe('VisitSummaryBanner', () => {
  it('shows loading and error states', () => {
    expect(render({ kind: 'loading' })).toContain('불러오고 있어요')
    const html = render({ kind: 'error', message: '새 소식을 불러오지 못했어요' })
    expect(html).toContain('role="alert"')
    expect(html).toContain('다시 시도')
  })

  it('renders nothing after dismissal', () => {
    expect(render({ kind: 'dismissed' })).toBe('')
  })

  it('greets a first visit', () => {
    const html = render({ kind: 'ready', summary: empty({ firstVisit: true, since: null }) })
    expect(html).toContain('처음 오셨네요')
    expect(html).toContain('확인했어요')
  })

  it('shows empty state when nothing is new', () => {
    expect(render({ kind: 'ready', summary: empty() })).toContain('새 소식이 없어요')
  })

  it('lists news with project badge, decisions link and report folder note', () => {
    const html = render({ kind: 'ready', summary: mockVisitSummary() })
    expect(html).toContain('T-040')
    expect(html).toContain('my-company')
    expect(html).toContain('결재함 보기')
    expect(html).toContain('reports 폴더')
    expect(html).toContain('role="alert"')
  })

  it('escapes titles', () => {
    const s = empty({ completedTickets: [{ id: 'T-1', title: '<b>x</b>', projectId: null }] })
    const html = render({ kind: 'ready', summary: s })
    expect(html).not.toContain('<b>x</b>')
  })

  it('shows confirm error', () => {
    const html = render(
      { kind: 'ready', summary: empty() },
      { confirmError: '확인 기록을 남기지 못했어요. 다시 눌러 주세요.' }
    )
    expect(html).toContain('확인 기록을 남기지 못했어요')
  })
})

describe('visit-model', () => {
  it('detects news and paused state', () => {
    expect(hasNews(empty())).toBe(false)
    expect(hasNews(mockVisitSummary())).toBe(true)
    const ks = { company: true, projects: [], updatedAt: null }
    expect(pausedLabel(empty({ killSwitch: ks }))).toContain('전체 중지')
    expect(hasNews(empty({ killSwitch: ks }))).toBe(true)
  })

  it('hides the auto section when nothing ran', () => {
    expect(autoGroups(empty({ audit: null }))).toEqual([])
    expect(
      autoGroups(
        empty({
          audit: {
            from: '',
            to: '',
            projects: [
              {
                projectId: 'p',
                counts: {
                  push: { executed: 2 },
                  merge: {},
                  publish: {}
                } as never,
                failures: []
              }
            ]
          }
        })
      )[0].executed
    ).toBe('푸시 2건')
  })
})

describe('VisitNotifySection', () => {
  it('starts loading', () => {
    const html = renderToStaticMarkup(<VisitNotifySection />)
    expect(html).toContain('알림')
    expect(html).toContain('불러오고 있어요')
  })
})
