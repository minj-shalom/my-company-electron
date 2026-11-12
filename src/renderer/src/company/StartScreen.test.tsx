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
  it('shows an error message and links it to the name field', () => {
    const html = render({ error: '같은 이름의 폴더가 이미 있어요.' })
    expect(html).toContain('같은 이름의 폴더가 이미 있어요.')
    expect(html).toContain('aria-describedby')
  })
  it('disables actions and marks busy while working', () => {
    const html = render({ busy: true })
    expect(html).toContain('aria-busy="true"')
    expect(html.match(/disabled/g)?.length).toBeGreaterThanOrEqual(4)
  })
})
