import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { buildScenarioEvents, createMockRunApi, parseRunScenario } from '../mock-run'
import { RunLogView } from './RunLogView'
import { applyEvents, EMPTY_STATE } from './run-log-model'
import type { RunLogView as View } from './use-run-log'

const render = (view: View): string =>
  renderToStaticMarkup(<RunLogView view={view} retry={() => {}} more={() => {}} />)
/** 실행 취소 버튼의 여는 태그. 이름(텍스트)으로 찾는다. */
const cancelButton = (html: string): string => {
  const end = html.indexOf('>실행 취소<')
  return html.slice(html.lastIndexOf('<button', end), end)
}
const withRun = (scenario: Parameters<typeof buildScenarioEvents>[0]): View => ({
  kind: 'ready',
  log: applyEvents(
    EMPTY_STATE,
    buildScenarioEvents(scenario).map((b) => ({ ...b, runId: 'mock-run-1' }))
  )
})

describe('RunLogView states', () => {
  it('renders connecting, error and empty', () => {
    expect(render({ kind: 'connecting' })).toContain('role="status"')
    const err = render({ kind: 'error' })
    expect(err).toContain('role="alert"')
    expect(err).toContain('다시 시도')
    expect(render({ kind: 'ready', log: EMPTY_STATE })).toContain('아직 일하는 직원이 없어요')
  })
  it('renders a finished run: kinds, text-only body, disabled cancel, usage', () => {
    const html = render(withRun('stream'))
    expect(html).toContain('role="log"')
    expect(html).toContain('aria-live="off"')
    for (const k of ['메시지', '도구', '결과']) expect(html).toContain(k)
    expect(html).toContain('&lt;b&gt;HTML은')
    expect(html).not.toContain('<b>HTML')
    expect(html).toContain('완료')
    expect(html).toContain('비용 $0.0123')
    expect(cancelButton(html)).toContain('disabled')
  })
  it('shows error runs with fixed text and no internal path', () => {
    const html = render(withRun('error'))
    expect(html).toContain('실행이 오류로 끝났어요.')
    expect(html).not.toContain('/Users/someone')
  })
  it('windows long logs and reports dropped events', () => {
    const html = render(withRun('long'))
    expect(html).toContain('더 보기')
    expect(html).toContain('보관 한도')
    expect(html.split('class="rev"').length - 1).toBeLessThanOrEqual(200)
  })
  it('enables cancel while running', () => {
    const log = applyEvents(EMPTY_STATE, [
      { runId: 'r', type: 'message', role: 'assistant', text: 'hi' }
    ])
    expect(cancelButton(render({ kind: 'ready', log }))).not.toContain('disabled')
  })
})

describe('mock run api', () => {
  it('parses scenarios', () => {
    expect(parseRunScenario('?mock-run=long')).toBe('long')
    expect(parseRunScenario('?mock-run=zzz')).toBe('idle')
    expect(buildScenarioEvents('long')).toHaveLength(5000)
  })
  it('streams to subscribers and resumes after unsubscribe', async () => {
    const api = createMockRunApi('stream', 1)
    const seen: string[] = []
    const off = api.onRunEvent((e) => seen.push(e.type))
    await new Promise((r) => setTimeout(r, 15))
    off()
    const n = seen.length
    expect(n).toBeGreaterThan(0)
    await new Promise((r) => setTimeout(r, 15))
    expect(seen).toHaveLength(n)
    const off2 = api.onRunEvent((e) => seen.push(e.type))
    await new Promise((r) => setTimeout(r, 60))
    off2()
    expect(seen.at(-1)).toBe('exit')
  })
  it('cancels a running mock run once', async () => {
    const api = createMockRunApi('stream', 50)
    const seen: string[] = []
    const off = api.onRunEvent((e) => seen.push(e.type))
    expect(await api.cancelRun('mock-run-1')).toBe(true)
    expect(await api.cancelRun('mock-run-1')).toBe(false)
    off()
    expect(seen.slice(-2)).toEqual(['error', 'exit'])
  })
})
