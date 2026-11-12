import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { OrgSnapshot } from '../../../shared/org'
import { FirstHireView, type FirstHireViewProps } from './FirstHireView'
import { HireBanners } from './HireBanners'
import type { FirstHireLoad, HireCard } from './hire-model'

const noop = (): void => {}
const cards = (exists: [boolean, boolean] = [false, false]): HireCard[] => [
  { id: 'pm', title: 'PM', role: 'r', description: 'PM 설명', note: 'PM 노트', exists: exists[0] },
  {
    id: 'developer',
    title: '개발자',
    role: 'r',
    description: '개발 설명',
    note: '프로젝트 성격에 따라 필요 없을 수도 있어요.',
    exists: exists[1]
  }
]
const ready = (over: Partial<Extract<FirstHireLoad, { kind: 'ready' }>> = {}): FirstHireLoad => ({
  kind: 'ready',
  cards: cards(),
  providerReady: true,
  ...over
})
const render = (p: Partial<FirstHireViewProps> = {}): string =>
  renderToStaticMarkup(
    <FirstHireView
      load={ready()}
      selected={new Set(['pm'])}
      phase={{ kind: 'idle' }}
      onToggle={noop}
      onHire={noop}
      onRetry={noop}
      onClose={noop}
      {...p}
    />
  )

describe('FirstHireView', () => {
  it('leads with the hr request (disabled with a reason), pm first, direct hire secondary', () => {
    const html = render()
    expect(html.indexOf('인사팀에 요청')).toBeLessThan(html.indexOf('바로 채용'))
    expect(html.indexOf('PM 설명')).toBeLessThan(html.indexOf('개발 설명'))
    expect(html).toMatch(/aria-disabled="true"[^>]*aria-describedby="([^"]+)"[^>]*>인사팀에 요청/)
    expect(html).toContain('준비 중')
    expect(html).toContain('프로젝트를 열려면 PM이 필요해요')
    expect(html).toContain('필요 없을 수도 있어요')
    expect(html).toContain('나중에')
  })
  it('labels checkboxes and checks only selected roles', () => {
    const html = render()
    expect(html).toMatch(/<label[^>]*><input type="checkbox" checked=""/)
    expect(html.match(/checked=""/g)?.length).toBe(1)
  })
  it('makes direct hire the primary action when no provider is connected', () => {
    const html = render({ load: ready({ providerReady: false }) })
    expect(html).toContain('AI 제공자가 아직 연결되지 않았어요')
    expect(html).toMatch(/btn btn--primary"[^>]*>바로 채용/)
  })
  it('blocks direct hire with nothing selected and while busy', () => {
    expect(render({ selected: new Set() })).toContain('하나 이상 골라')
    const busy = render({ phase: { kind: 'busy' } })
    expect(busy).toContain('채용하는 중')
    expect(busy).toContain('disabled=""')
  })
  it('shows existing roles as already hired and disabled', () => {
    const html = render({ load: ready({ cards: cards([true, false]) }) })
    expect(html).toContain('이미 있어요')
    const all = render({ load: ready({ cards: cards([true, true]) }) })
    expect(all).toContain('이미 모두 있어요')
    expect(all).not.toContain('바로 채용')
  })
  it('renders loading, error, failure and done states', () => {
    expect(render({ load: { kind: 'loading' } })).toContain('role="status"')
    const err = render({ load: { kind: 'error', message: '불러오지 못했어요' } })
    expect(err).toContain('role="alert"')
    expect(err).toContain('다시 시도')
    expect(render({ phase: { kind: 'error', message: '실패 문구' } })).toContain('실패 문구')
    const done = render({
      phase: { kind: 'done', message: 'PM을(를) 채용했어요.', hired: ['pm'], skipped: [] }
    })
    expect(done).toContain('PM을(를) 채용했어요.')
    expect(done).toContain('프로젝트를 추가하고 담당 PM')
    expect(done).not.toContain('바로 채용')
  })
  it('never uses raw html injection', () => {
    expect(render()).not.toContain('dangerouslySetInnerHTML')
  })
})

describe('HireBanners', () => {
  const snap = (
    agentIds: string[],
    missing: OrgSnapshot['missingBaseRoles'] = []
  ): OrgSnapshot => ({
    org: {
      members: agentIds.map((id) => ({
        title: id,
        kind: 'agent' as const,
        agentId: id,
        fileExists: true,
        department: 'x',
        reportsTo: null,
        role: ''
      })),
      departments: [],
      tree: [],
      chart: [],
      issues: []
    },
    agents: [],
    missingBaseRoles: missing
  })
  const html = (s: OrgSnapshot, first?: () => void): string =>
    renderToStaticMarkup(<HireBanners snapshot={s} onFirstHire={first} onChanged={noop} />)

  it('shows the first hire CTA when pm is missing', () => {
    const out = html(snap(['cto', 'cfo', 'hr']), noop)
    expect(out).toContain('첫 채용 시작')
    expect(out).not.toContain('인사팀 추가')
  })
  it('shows the hr add notice only when hr is missing, and states nothing changes before the click', () => {
    const out = html(snap(['cto', 'pm'], ['hr']), noop)
    expect(out).toContain('인사팀이 없어요')
    expect(out).toContain('누르기 전에는 아무것도 바뀌지 않아요')
    expect(out).not.toContain('첫 채용 시작')
  })
  it('renders nothing for a complete org', () => {
    expect(html(snap(['cto', 'cfo', 'hr', 'pm']), noop)).toBe('')
  })
})
