import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { StartScreen } from './StartScreen'

const noop = (): void => {}
const render = (props: Partial<Parameters<typeof StartScreen>[0]> = {}): string =>
  renderToStaticMarkup(
    <StartScreen busy={false} onCreate={noop} onOpen={noop} onRecheck={noop} {...props} />
  )

describe('StartScreen', () => {
  // node 환경이라 ThemeToggle의 useTheme이 읽는 window를 최소한으로 흉내 낸다.
  beforeAll(() => vi.stubGlobal('window', {}))
  afterAll(() => vi.unstubAllGlobals())
  it('offers create, open and recheck, with a labelled name field and no path input', () => {
    const html = render()
    expect(html).toContain('새 회사 만들기')
    expect(html).toContain('회사 폴더 열기')
    expect(html).toContain('마지막 회사 확인')
    expect(html).toMatch(/<label for="([^"]+)">회사 이름<\/label><input[^>]*id="\1"/)
    expect(html).not.toMatch(/경로|path/i)
  })
  it('shows a missing notice as an alert with only the folder name', () => {
    const html = render({ notice: { reason: 'missing', name: 'Acme' } })
    expect(html).toContain('role="alert"')
    expect(html).toContain('회사 폴더를 찾을 수 없어요')
    expect(html).toContain('Acme')
  })
  it('links only name errors to the name field', () => {
    const named = render({ error: '이름 문제', errorField: 'name' })
    expect(named).toContain('이름 문제')
    expect(named).toContain('aria-describedby')
    expect(named).toContain('aria-invalid="true"')
    const general = render({ error: '열기 문제' })
    expect(general).toContain('열기 문제')
    expect(general).not.toContain('aria-describedby')
    expect(general).not.toContain('aria-invalid')
  })
  it('limits the name to 50 characters and shows info in a status region', () => {
    const html = render({ info: '저장된 회사가 없어요.' })
    expect(html).toContain('maxLength="50"')
    expect(html).toMatch(/role="status"[^>]*>저장된 회사가 없어요\./)
  })
  it('disables actions and marks busy while working', () => {
    const html = render({ busy: true })
    expect(html).toContain('aria-busy="true"')
    expect(html.match(/disabled/g)?.length).toBeGreaterThanOrEqual(4)
  })
})
