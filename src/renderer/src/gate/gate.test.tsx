import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { AuditSummary, KillSwitchState } from '../../../shared/gate'
import type { ProjectInfo } from '../../../shared/project'
import { AutoRunLog } from './AutoRunLog'
import { KillSwitchControl } from './KillSwitchControl'
import { isProjectPaused, killSwitchView, todayRange } from './gate-model'
import type { UseKillSwitch } from './use-kill-switch'

const st = (over: Partial<KillSwitchState> = {}): KillSwitchState => ({
  company: false,
  projects: [],
  updatedAt: null,
  ...over
})
const ks = (load: UseKillSwitch['load'], over: Partial<UseKillSwitch> = {}): UseKillSwitch => ({
  load,
  busy: false,
  error: null,
  reload: () => {},
  set: async () => {},
  ...over
})
const project = { id: 'a', name: '<b>앱</b>' } as ProjectInfo
const zero = {
  executed: 0,
  failed: 0,
  'blocked-limit': 0,
  'blocked-killswitch': 0,
  'blocked-target': 0,
  'blocked-review': 0,
  'fallback-card': 0,
  duplicate: 0
}

describe('kill switch view', () => {
  it('maps states to badges and button labels', () => {
    expect(killSwitchView(st(), 0).badge).toBeNull()
    expect(killSwitchView(st(), 2).badge?.label).toBe('자동 모드 중 (프로젝트 2개)')
    expect(killSwitchView(st({ projects: ['a'] }), 2).badge?.label).toContain('프로젝트 1개')
    const all = killSwitchView(st({ company: true }), 2)
    expect(all.paused).toBe(true)
    expect(all.buttonLabel).toBe('자동 실행 재개')
    expect(isProjectPaused(st({ company: true }), 'x')).toBe(true)
  })
  it('today range spans 24h of local day', () => {
    const r = todayRange(new Date(2026, 10, 13, 15, 0))
    expect(new Date(r.to).getTime() - new Date(r.from).getTime()).toBeGreaterThanOrEqual(
      23 * 3600e3
    )
  })
})

describe('KillSwitchControl', () => {
  const html = (k: UseKillSwitch): string =>
    renderToStaticMarkup(<KillSwitchControl ks={k} autoProjectCount={1} />)
  it('renders running, paused, loading and error', () => {
    expect(html(ks({ kind: 'ready', state: st() }))).toContain('자동 실행 모두 중지')
    const paused = html(ks({ kind: 'ready', state: st({ company: true }) }))
    expect(paused).toContain('일시 중지됨 (전체)')
    expect(paused).toContain('자동 실행 재개')
    expect(html(ks({ kind: 'loading' }))).toContain('확인 중')
    const err = html(ks({ kind: 'error', message: '읽지 못했어요' }))
    expect(err).toContain('role="alert"')
    expect(err).toContain('다시 시도')
  })
})

describe('AutoRunLog', () => {
  const ready = ks({ kind: 'ready', state: st() })
  const render = (audit: Parameters<typeof AutoRunLog>[0]['audit'], k = ready): string =>
    renderToStaticMarkup(
      <AutoRunLog projects={[project]} audit={audit} onReload={() => {}} ks={k} />
    )
  const summary = (projects: AuditSummary['projects']): AuditSummary => ({
    from: 'a',
    to: 'b',
    projects
  })
  it('loading, error and empty', () => {
    expect(render({ kind: 'loading' })).toContain('불러오고 있어요')
    expect(render({ kind: 'error', message: '실패' })).toContain('role="alert"')
    expect(render({ kind: 'ready', summary: summary([]) })).toContain(
      '오늘 자동 실행 기록이 없어요'
    )
  })
  it('shows counts and failures as escaped text', () => {
    const counts = { push: { ...zero, executed: 2 }, merge: { ...zero }, publish: { ...zero } }
    const out = render({
      kind: 'ready',
      summary: summary([
        {
          projectId: 'a',
          counts: { ...counts, push: { ...counts.push, 'blocked-limit': 1 } },
          failures: [
            {
              at: '2026-11-13T05:00:00.000Z',
              action: 'push',
              target: '<i>x</i>',
              result: 'blocked-limit',
              employee: 'e',
              ticket: 'T-1'
            }
          ]
        }
      ])
    })
    expect(out).toContain('푸시 2건')
    expect(out).toContain('일일 상한으로 막힘')
    expect(out).not.toContain('<i>x</i>')
    expect(out).not.toContain('<b>앱</b>')
    expect(out).toContain('이 프로젝트만 중지')
  })
  it('hides project button when company paused', () => {
    const out = render(
      { kind: 'ready', summary: summary([]) },
      ks({ kind: 'ready', state: st({ company: true }) })
    )
    expect(out).toContain('일시 중지됨')
    expect(out).not.toContain('이 프로젝트만 중지')
  })
})
