import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { InstallSafety } from './InstallSafety'
import { SAFETY_TEXT, extractSourceUrls, isPipedInstaller } from './install-safety'
import { OS_LABELS, PROVIDER_GUIDES, type OsKind } from './provider-guide'

const render = (os: OsKind, id: string): string => {
  const g = PROVIDER_GUIDES.find((x) => x.id === id)!
  return renderToStaticMarkup(createElement(InstallSafety, { commands: g.install[os] }))
}

describe('install safety notice', () => {
  it('shows piped-script warning, source url text, and run-by-you notice for curl installers', () => {
    const html = render('unix', 'claude')
    expect(html).toContain('설치 전에 확인하세요')
    expect(html).toContain('<code>https://claude.ai/install.sh</code>')
    expect(html).toContain(SAFETY_TEXT.piped)
    expect(html).toContain('대신 실행하지 않아요')
    expect(html).toContain('공식 문서 열기')
    expect(html).not.toContain('ByPass')
  })
  it('explains ExecutionPolicy ByPass only for the Windows codex command', () => {
    const html = render('windows', 'codex')
    expect(html).toContain('<code>https://chatgpt.com/codex/install.ps1</code>')
    expect(html).toContain('ExecutionPolicy ByPass')
    expect(html).toContain('이번 한 번의 실행')
    expect(render('windows', 'claude')).not.toContain('ExecutionPolicy')
  })
  it('does not claim a piped download for plain npm installs but still says the user runs it', () => {
    const html = render('windows', 'gemini')
    expect(html).not.toContain(SAFETY_TEXT.piped)
    expect(html).toContain(SAFETY_TEXT.runByYou)
  })
  it('classifies every piped official command', () => {
    for (const g of PROVIDER_GUIDES) {
      for (const os of Object.keys(OS_LABELS) as OsKind[]) {
        for (const c of g.install[os]) {
          if (/curl|irm/.test(c.command)) {
            expect(isPipedInstaller(c.command)).toBe(true)
            expect(extractSourceUrls([c]).length).toBe(1)
          }
        }
      }
    }
  })
})
