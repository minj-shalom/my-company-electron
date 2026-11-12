import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// @import가 다른 규칙 뒤에 있으면 브라우저가 무시해 스타일이 통째로 사라진다.
describe('main.css', () => {
  const css = readFileSync(join(__dirname, 'main.css'), 'utf8')
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')

  it('keeps every @import before any rule', () => {
    const lastImport = stripped.lastIndexOf('@import')
    const firstRule = stripped.search(/[^\s@][^{;]*\{/)
    expect(lastImport).toBeGreaterThanOrEqual(0)
    expect(firstRule).toBeGreaterThan(lastImport)
  })

  it('imports onboarding.css', () => {
    expect(stripped).toContain("@import './onboarding.css'")
  })
})
