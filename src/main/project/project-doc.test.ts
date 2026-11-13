import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseFieldLine, parseEmployeeListValue, parsePmValue } from './field-lines'
import {
  addProject,
  makeProjectId,
  parseProjectDoc,
  patchProject,
  serializeProjectDoc,
  viewProjectDoc,
  type DocProject
} from './project-doc'
import { FIXTURE_PROJECT_MD } from './test-project-company'

const real = readFileSync(FIXTURE_PROJECT_MD, 'utf8')
const P = (over: Partial<DocProject> = {}): DocProject => ({
  id: 'blog',
  name: '블로그',
  type: 'content',
  path: '/abs/blog',
  devCommand: null,
  defaultBranch: null,
  status: 'active',
  pmId: null,
  ...over
})

describe('field line parser', () => {
  it('reads `- key: value` only at column 0', () => {
    expect(parseFieldLine('- PM: pm')).toMatchObject({ key: 'PM', value: 'pm', forged: false })
    expect(parseFieldLine('  - PM: pm')).toBeNull()
    expect(parseFieldLine('- no colon')).toBeNull()
    expect(parseFieldLine('- dev 명령: npm run dev -- --host')?.value).toBe('npm run dev -- --host')
  })
  it('flags forged line breaks and invisible characters', () => {
    expect(parseFieldLine('- PM:\tpm\t')).toMatchObject({ key: 'PM', value: 'pm', forged: false })
    expect(parseFieldLine('- dev 명령: a\tb')?.forged).toBe(false)
    expect(parseFieldLine('- PM: pm\rx')?.forged).toBe(true)
    expect(parseFieldLine('- PM: pm - 상태: archived')?.forged).toBe(true)
    expect(parseFieldLine('- PM: p​m')?.forged).toBe(true)
  })
  it('validates PM and staff values', () => {
    expect(parsePmValue('pm')).toBe('pm')
    expect(parsePmValue('pm, dev')).toBeNull()
    expect(parsePmValue('__proto__')).toBeNull()
    expect(parseEmployeeListValue('a, b')).toEqual(['a', 'b'])
    expect(parseEmployeeListValue('a,')).toBeNull()
  })
})

describe('legacy single format (this company project.md)', () => {
  it('reads project_dir and extra_project_dirs as projects', () => {
    const v = viewProjectDoc(parseProjectDoc(real))
    expect(v.format).toBe('legacy')
    expect(v.items.map((p) => [p.id, p.name, p.path, p.devCommand, p.type, p.pmId])).toEqual([
      [
        'my-company',
        'My Company',
        '../my-company-electron',
        'npm run dev -- --host',
        'development',
        null
      ],
      [
        'my-company-landing',
        'my-company-landing',
        '../my-company-landing',
        null,
        'development',
        null
      ]
    ])
  })
  it('treats (미설정) as no project', () => {
    const v = viewProjectDoc(parseProjectDoc('- project_name: x\n- project_dir: (미설정)\n'))
    expect(v).toMatchObject({ items: [], format: 'empty' })
  })
  it('does not change the text unless asked to serialize a change', () => {
    const doc = parseProjectDoc(real)
    expect(serializeProjectDoc(doc)).toBe(real)
  })
  it('converts on save: original lines (script keys) stay, blocks come after', () => {
    const next = serializeProjectDoc(addProject(parseProjectDoc(real), P()))
    expect(next.startsWith(real.trimEnd())).toBe(true)
    // scripts/dev.sh의 `sed -n "s/^- project_dir: *//p" | head -1` 와 같은 규칙으로 읽어도 첫 값이 그대로다.
    const first = (key: string): string | undefined =>
      next
        .split('\n')
        .find((l) => l.startsWith(`- ${key}: `))
        ?.slice(key.length + 3)
        .trim()
    expect(first('project_dir')).toBe('../my-company-electron')
    expect(first('dev_command')).toBe('npm run dev -- --host')
    expect(first('dev_session')).toBe('dev')
    const v = viewProjectDoc(parseProjectDoc(next))
    expect(v.format).toBe('blocks')
    expect(v.items.map((p) => p.id)).toEqual(['my-company', 'my-company-landing', 'blog'])
    // 변환 후에도 같은 문서를 다시 직렬화하면 그대로다 (왕복).
    expect(serializeProjectDoc(parseProjectDoc(next))).toBe(next)
  })
})

describe('block format', () => {
  const text = [
    '# 프로젝트 설정',
    '',
    '## 프로젝트: 웹 앱',
    '- id: web',
    '- 유형: development',
    '- 경로: /abs/web',
    '- 직원: dev-a, dev-b',
    '- 정책: policies/web.md',
    '임의 메모 줄',
    '',
    '## 메모',
    '- 아무 것이나',
    ''
  ].join('\n')
  it('keeps unknown lines and other sections byte for byte when patching', () => {
    const doc = patchProject(parseProjectDoc(text), 'web', { name: '웹 앱 2', pmId: 'pm' })
    expect(doc).not.toBeNull()
    const out = serializeProjectDoc(doc!)
    expect(out).toBe(
      text
        .replace('## 프로젝트: 웹 앱', '## 프로젝트: 웹 앱 2')
        // 새 필드는 마지막 알려진 필드 줄 뒤에 들어간다.
        .replace('- 경로: /abs/web\n', '- 경로: /abs/web\n- PM: pm\n')
    )
  })
  it('removes a field line when its value is cleared and keeps the rest', () => {
    const withPm = text.replace('- 경로: /abs/web', '- 경로: /abs/web\n- PM: pm')
    const out = serializeProjectDoc(patchProject(parseProjectDoc(withPm), 'web', { pmId: null })!)
    expect(out).toBe(text)
  })
  it('preserves CRLF files', () => {
    const crlf = text.replace(/\n/g, '\r\n')
    const out = serializeProjectDoc(patchProject(parseProjectDoc(crlf), 'web', { name: 'W' })!)
    expect(out.split('\r\n').length).toBe(crlf.split('\r\n').length)
    expect(out.replace(/\r\n/g, '\n').includes('\r')).toBe(false)
  })
  it('ignores headings inside code fences', () => {
    const fenced = '```\n## 프로젝트: x\n- id: x\n```\n'
    expect(viewProjectDoc(parseProjectDoc(fenced)).items).toEqual([])
  })
})

describe('structure forgery', () => {
  const block = (lines: string[]): string => ['## 프로젝트: A', ...lines, ''].join('\n')
  it.each([
    ['__proto__ id', ['- id: __proto__', '- 경로: /a']],
    ['id with uppercase', ['- id: Abc', '- 경로: /a']],
    ['duplicate id key', ['- id: a', '- id: b', '- 경로: /a']],
    ['duplicate PM key', ['- id: a', '- 경로: /a', '- PM: x', '- PM: y']],
    ['bad type', ['- id: a', '- 경로: /a', '- 유형: evil']],
    ['bad status', ['- id: a', '- 경로: /a', '- 상태: gone']],
    ['bad PM', ['- id: a', '- 경로: /a', '- PM: a, b']],
    ['lone CR in a field', ['- id: a', '- 경로: /a\r- 상태: archived']],
    ['LS in a field', ['- id: a', '- 경로: /a - 상태: archived']],
    ['missing path', ['- id: a']]
  ])('marks the block unreadable: %s', (_n, lines) => {
    const v = viewProjectDoc(parseProjectDoc(block(lines)))
    expect(v.items).toEqual([])
    expect(v.issueLines).toEqual([1])
  })
  it('rejects a second block with a duplicate id or name', () => {
    const t = [
      '## 프로젝트: A',
      '- id: a',
      '- 경로: /a',
      '',
      '## 프로젝트: a',
      '- id: b',
      '- 경로: /b',
      ''
    ].join('\n')
    expect(viewProjectDoc(parseProjectDoc(t)).items.map((p) => p.id)).toEqual(['a'])
  })
  it('never treats prototype keys as ids', () => {
    expect(makeProjectId('__proto__', new Set())).toBe('proto')
    expect(makeProjectId('한글', new Set())).toBe('project')
    expect(makeProjectId('한글', new Set(['project']))).toBe('project-2')
    expect(makeProjectId('My Company!', new Set())).toBe('my-company')
  })
})

describe('linear time on 1MB input', () => {
  const LIMIT_MS = 3000
  const timed = (fn: () => unknown): number => {
    const t = Date.now()
    fn()
    return Date.now() - t
  }
  it('long whitespace field line with a lone CR', () => {
    const text = `## 프로젝트: A\n- id: a\n- 경로:${' '.repeat(1_000_000)}\rx\n`
    expect(timed(() => viewProjectDoc(parseProjectDoc(text)))).toBeLessThan(LIMIT_MS)
  })
  it('many small blocks and fence toggles', () => {
    const text = '## 프로젝트: A\n- id: a\n- 경로: /a\n```\n'.repeat(25_000).slice(0, 1_000_000)
    expect(timed(() => viewProjectDoc(parseProjectDoc(text)))).toBeLessThan(LIMIT_MS)
    const many = Array.from(
      { length: 20_000 },
      (_, i) => `## 프로젝트: P${i}\n- id: p${i}\n- 경로: /p${i}\n`
    ).join('')
    expect(timed(() => viewProjectDoc(parseProjectDoc(many)))).toBeLessThan(LIMIT_MS)
    // 읽는 블록 수에는 상한이 있다.
    expect(viewProjectDoc(parseProjectDoc(many)).items.length).toBeLessThanOrEqual(200)
  })
  it('legacy scan of a huge file', () => {
    const text = '- x: y\n'.repeat(140_000)
    expect(timed(() => viewProjectDoc(parseProjectDoc(text)))).toBeLessThan(LIMIT_MS)
  })
})
