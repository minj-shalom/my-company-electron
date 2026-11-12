import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ApiResult } from '../../shared/result'
import { loadOrg, removeMember, updateMember } from '../org/org-store'
import { splitFrontmatter } from '../repository/markdown'
import { checkBody, checkDescription } from './agent-file'
import {
  agentText,
  makeCompany,
  orgText,
  put,
  snapshotAgents,
  type TestCompany
} from './test-company'

const made: TestCompany[] = []
async function company(): Promise<TestCompany> {
  const c = await makeCompany()
  made.push(c)
  return c
}
afterEach(async () => {
  for (const c of made.splice(0)) await rm(c.dir, { recursive: true, force: true })
})

const ch = (n: number): string => String.fromCharCode(n)
const code = (r: ApiResult<unknown>): string => (r.ok ? 'ok' : r.code)
// \r, NEL, VT, FF, LS, PS 그리고 \n 자체.
const BREAKS = [0x0d, 0x85, 0x0b, 0x0c, 0x2028, 0x2029, 0x0a].map(ch)
const LIMIT_MS = 3000
const timed = (fn: () => unknown): number => {
  const t = Date.now()
  fn()
  return Date.now() - t
}

describe('line break variants cannot forge structure in agent files', () => {
  it('rejects every variant (and NUL) inside a one-line description', async () => {
    const c = await company()
    const before = await snapshotAgents(c)
    for (const b of [...BREAKS, ch(0)]) {
      const evil = `ok${b}---${b}name: evil${b}# 가짜 헤딩`
      expect(checkDescription(evil).ok).toBe(false)
      expect(code(await c.service.update({ id: 'pm', description: evil }, 'ceo-ui'))).toBe(
        'invalid-request'
      )
    }
    expect(await snapshotAgents(c)).toEqual(before)
  })

  it('normalizes body line breaks and keeps the frontmatter fields intact', async () => {
    const c = await company()
    const before = splitFrontmatter(await agentText(c, 'pm')).data
    for (const b of BREAKS.slice(0, 6)) {
      const body = `# 제목${b}---${b}name: evil${b}${b}## 가짜 헤딩${b}끝`
      await c.service.update({ id: 'pm', body }, 'ceo-ui').then((r) => expect(r.ok).toBe(true))
      const text = await agentText(c, 'pm')
      const f = splitFrontmatter(text)
      // 의도한 필드만 있고 본문 줄바꿈은 모두 \n이다.
      expect(f.data).toEqual(before)
      expect(f.body).toBe('\n# 제목\n---\nname: evil\n\n## 가짜 헤딩\n끝\n')
      // eslint-disable-next-line no-control-regex -- 줄바꿈 변형이 남지 않았는지 확인
      expect(text).not.toMatch(/[\r\u0085\u000b\u000c\u2028\u2029]/)
    }
  })

  it('a body that starts like frontmatter does not become frontmatter', async () => {
    const c = await company()
    await c.service.update({ id: 'pm', body: '---\nname: evil\ntools: Bash\n---\n내용' }, 'ceo-ui')
    const f = splitFrontmatter(await agentText(c, 'pm'))
    expect(f.data.name).toBe('pm')
    expect(f.data.tools).not.toBe('Bash')
    expect(f.body).toContain('name: evil')
  })

  it('round-trips descriptions that look like YAML or headings', async () => {
    const c = await company()
    for (const d of [
      '# 헤딩처럼',
      'key: value # c',
      '---',
      '"quoted"',
      "it's",
      '[a, b]',
      '- item',
      'yes',
      '123'
    ]) {
      await c.service.update({ id: 'pm', description: d }, 'ceo-ui')
      const f = splitFrontmatter(await agentText(c, 'pm'))
      expect(f.data.description, d).toBe(d)
      expect(f.data.name).toBe('pm')
    }
  })

  it('rejects other control characters in the body but keeps tabs', () => {
    expect(checkBody(`a${ch(1)}b`).ok).toBe(false)
    expect(checkBody(`a${ch(0x7f)}b`).ok).toBe(false)
    expect(checkBody(`a${ch(0xfeff)}b`).ok).toBe(false)
    expect(checkBody('a\tb')).toEqual({ ok: true, value: 'a\tb\n' })
  })
})

describe('linear time on 1MB hostile input', () => {
  const MB = 1_000_000
  const hostile = [
    ['blank lines', '\n'.repeat(MB)],
    ['spaces then lone CR', `${' '.repeat(MB / 2)}\r${' '.repeat(MB / 2 - 1)}x`],
    ['CR LS PS mix', 'a \r\u2028\u2029 '.repeat(MB / 10)],
    ['whitespace then text', `${' \t'.repeat(MB / 2 - 2)}x`]
  ] as const

  it.each(hostile)('body: %s', (_name, input) => {
    expect(timed(() => checkBody(input))).toBeLessThan(LIMIT_MS)
  })
  it.each(hostile)('description: %s', (_name, input) => {
    expect(timed(() => checkDescription(input))).toBeLessThan(LIMIT_MS)
  })

  it('service rejects a 1MB+ body without work and accepts hostile org rows quickly', async () => {
    const c = await company()
    const t = Date.now()
    expect(code(await c.service.update({ id: 'pm', body: 'x'.repeat(MB + 1) }, 'ceo-ui'))).toBe(
      'invalid-request'
    )
    expect(code(await c.service.update({ id: 'pm', description: ' '.repeat(MB) }, 'ceo-ui'))).toBe(
      'invalid-request'
    )
    expect(Date.now() - t).toBeLessThan(LIMIT_MS)
  })

  it('org edits stay fast when org.md is full of blank/whitespace lines and lone CRs', async () => {
    const c = await company()
    const filler = `${'\n'.repeat(50_000)}${' '.repeat(100_000)}\r${' '.repeat(50_000)}\n`
    const org = await orgText(c)
    await writeFile(join(c.dir, 'company/org.md'), `${org}\n${filler}`)
    const t = Date.now()
    expect(code(await c.service.move({ id: 'developer', department: '플랫폼팀' }, 'ceo-ui'))).toBe(
      'ok'
    )
    expect(code(await c.service.retire({ id: 'reviewer-qa', approval: 'D-012' }, 'ceo-ui'))).toBe(
      'ok'
    )
    expect(Date.now() - t).toBeLessThan(LIMIT_MS)
  })
})

describe('org-store updateMember / removeMember', () => {
  it('only touches the edited line and keeps mixed line endings and BOM', async () => {
    const c = await company()
    const org = (await orgText(c)).split('\n')
    // 줄마다 줄바꿈을 섞는다: 짝수 줄은 CRLF.
    const mixed = `\ufeff${org.map((l, i) => (i % 2 ? `${l}\r\n` : `${l}\n`)).join('')}`.replace(
      /\n$/,
      ''
    )
    await put(c.dir, 'company/org.md', mixed)
    const r = await updateMember(c.fs, 'developer', { role: '범용 구현과 리팩터링' })
    expect(r.ok).toBe(true)
    const after = await orgText(c)
    expect(after.startsWith('\ufeff')).toBe(true)
    const a = after.split(/(\r?\n)/)
    const b = mixed.split(/(\r?\n)/)
    expect(a.length).toBe(b.length)
    const diff = a.map((x, i) => (x === b[i] ? null : i)).filter((x) => x !== null)
    expect(diff.length).toBe(1)
    expect(a[diff[0] as number]).toContain('범용 구현과 리팩터링')
  })

  it('removes a last row that has no trailing newline', async () => {
    const c = await company()
    const org = await orgText(c)
    const idx = org.indexOf('| QA ')
    // QA 행 뒤를 모두 잘라 표의 마지막 줄이면서 파일의 마지막 줄로 만든다.
    const lineEnd = org.indexOf('\n', idx)
    await put(c.dir, 'company/org.md', org.slice(0, lineEnd))
    expect((await removeMember(c.fs, 'reviewer-qa')).ok).toBe(true)
    const after = await orgText(c)
    expect(after).not.toContain('`reviewer-qa`')
    expect(after.endsWith('\n')).toBe(false)
    expect((await loadOrg(c.fs)).members.length).toBe(11)
  })

  it('refuses edits that would create issues and leaves the file alone', async () => {
    const c = await company()
    const before = await orgText(c)
    // CTO를 지우면 CTO에게 보고하는 직원이 생겨 새 오류가 난다.
    expect((await removeMember(c.fs, 'cto')).ok).toBe(false)
    expect((await updateMember(c.fs, 'developer', { reportsTo: '없음' })).ok).toBe(false)
    expect((await updateMember(c.fs, 'developer', { title: 'a|b' })).ok).toBe(false)
    expect((await updateMember(c.fs, 'developer', {})).ok).toBe(false)
    expect((await updateMember(c.fs, '../x', { role: 'x' })).ok).toBe(false)
    expect((await removeMember(c.fs, 'nobody')).ok).toBe(false)
    expect(await orgText(c)).toBe(before)
  })

  it('escapes cell values so a role cannot add columns', async () => {
    const c = await company()
    expect((await updateMember(c.fs, 'developer', { role: 'a | b | c' })).ok).toBe(true)
    const m = (await loadOrg(c.fs)).members.find((x) => x.agentId === 'developer')
    expect(m?.role).toBe('a | b | c')
    expect(await readFile(join(c.dir, 'company/org.md'), 'utf8')).toContain('a \\| b \\| c')
  })
})
