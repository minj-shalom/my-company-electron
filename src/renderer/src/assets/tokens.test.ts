/// <reference types="node" />
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'

const dir = new URL('./', import.meta.url)
const read = (name: string): string => readFileSync(new URL(name, dir), 'utf8')
const tokensCss = read('tokens.css')

function block(selector: string): Record<string, string> {
  const start = tokensCss.indexOf(selector)
  const open = tokensCss.indexOf('{', start)
  const close = tokensCss.indexOf('\n}', open)
  const vars: Record<string, string> = {}
  for (const m of tokensCss.slice(open, close).matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})\b/g)) {
    vars[m[1]] = m[2]
  }
  return vars
}

const dark = block(':root {')
const light = { ...dark, ...block(":root[data-theme='light']") }

type Rgb = [number, number, number]
const rgb = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb
const mix = (a: Rgb, b: Rgb, ratioA: number): Rgb =>
  a.map((v, i) => v * ratioA + b[i] * (1 - ratioA)) as Rgb
function luminance(c: Rgb): number {
  const [r, g, b] = c.map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const TEXT_ON: [string, string][] = []
for (const fg of ['--text', '--text-muted', '--link']) {
  for (const bg of ['--bg-app', '--bg-panel', '--bg-panel-raised', '--bg-inset']) {
    TEXT_ON.push([fg, bg])
  }
}
for (const fg of ['--ok', '--warn', '--bad', '--info', '--working']) {
  TEXT_ON.push([fg, '--bg-panel'], [fg, '--bg-inset'])
}
TEXT_ON.push(
  ['--ok', '--bg-app'],
  ['--ok', '--bg-panel-raised'],
  ['--bad', '--bg-panel-raised'],
  ['--warn', '--bg-panel-raised']
)
TEXT_ON.push(['--accent-ink', '--accent'], ['--accent-ink', '--accent-hover'])

const NON_TEXT_ON: [string, string][] = [
  ['--border-strong', '--bg-panel'],
  ['--border-strong', '--bg-inset'],
  ['--border-strong', '--bg-panel-raised'],
  ['--focus', '--bg-app'],
  ['--focus', '--bg-panel'],
  ['--focus', '--bg-inset']
]

describe.each([
  ['dark', dark],
  ['light', light]
])('%s theme contrast (WCAG AA)', (_name, t) => {
  it.each(TEXT_ON)('text %s on %s >= 4.5', (fg, bg) => {
    expect(contrast(rgb(t[fg]), rgb(t[bg]))).toBeGreaterThanOrEqual(4.5)
  })
  it.each(NON_TEXT_ON)('ui %s on %s >= 3', (fg, bg) => {
    expect(contrast(rgb(t[fg]), rgb(t[bg]))).toBeGreaterThanOrEqual(3)
  })
  it.each(['--ok', '--warn', '--bad', '--info'])('badge %s text on its tinted fill >= 4.5', (v) => {
    // .badge의 배경: color-mix(색 15%, 패널)
    const fill = mix(rgb(t[v]), rgb(t['--bg-panel']), 0.15)
    expect(contrast(rgb(t[v]), fill)).toBeGreaterThanOrEqual(4.5)
  })
  it('muted text on badge neutral fill >= 4.5', () => {
    const fill = mix(rgb(t['--text-muted']), rgb(t['--bg-panel']), 0.15)
    expect(contrast(rgb(t['--text-muted']), fill)).toBeGreaterThanOrEqual(4.5)
  })
})

describe('token discipline', () => {
  const others = readdirSync(dir).filter((f) => f.endsWith('.css') && f !== 'tokens.css')
  it.each(others)('%s has no raw hex colors or legacy --ev-c variables', (file) => {
    const css = read(file).replace(/\/\*[\s\S]*?\*\//g, '')
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(css).not.toContain('--ev-')
  })
  it('light theme overrides every dark color token', () => {
    const lightOnly = block(":root[data-theme='light']")
    expect(Object.keys(lightOnly).sort()).toEqual(Object.keys(dark).sort())
  })
  it('defines both themes', () => {
    expect(Object.keys(dark).length).toBeGreaterThan(10)
    expect(tokensCss).toContain(":root[data-theme='light']")
  })
})
