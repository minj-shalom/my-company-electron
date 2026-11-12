/// <reference types="node" />
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

// @import가 다른 규칙 뒤에 있으면 브라우저가 무시해 스타일이 통째로 사라진다.
describe('main.css', () => {
  const mainCss = readFileSync(new URL('./main.css', import.meta.url), 'utf8')
  const stripped = mainCss.replace(/\/\*[\s\S]*?\*\//g, '')

  it('keeps every @import before any rule', () => {
    const lastImport = stripped.lastIndexOf('@import')
    const firstRule = stripped.search(/[^\s@][^{;]*\{/)
    expect(lastImport).toBeGreaterThanOrEqual(0)
    // main.css에 규칙이 없으면(-1) 순서 문제도 없다.
    if (firstRule !== -1) expect(firstRule).toBeGreaterThan(lastImport)
  })

  it.each(['tokens', 'base', 'components', 'shell', 'onboarding'])('imports %s.css', (name) => {
    expect(stripped).toContain(`@import './${name}.css'`)
  })
})
