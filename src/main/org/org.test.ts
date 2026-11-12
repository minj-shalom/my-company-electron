import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { OrgIssueCode, OrgModel } from '../../shared/org'
import type { ApiResult } from '../../shared/result'
import { SafeFs } from '../repository/safe-fs'
import { addDepartment, addMember, loadOrg } from './org-store'
import { MAX_ORG_BYTES, parseOrgDocument } from './parse-org-doc'

const REAL = await readFile(new URL('./fixtures/real-org.md', import.meta.url), 'utf8')
const REAL_AGENTS = [
  'cto',
  'cfo',
  'pm',
  'developer',
  'electron-main-dev',
  'ui-dev',
  'devops',
  'web-frontend-dev',
  'reviewer-qa'
]

const codes = (m: OrgModel): OrgIssueCode[] => m.issues.map((i) => i.code)
const parse = (text: string, agents: string[] = []): OrgModel =>
  parseOrgDocument(text, new Set(agents))

const HEAD = `## 직원 목록
| 직급 | 직원 파일 | 부서 | 보고 대상 | 역할 |
|---|---|---|---|---|
`

describe('parseOrgDocument (real company/org.md fixture)', () => {
  const m = parse(REAL, REAL_AGENTS)

  it('parses without issues', () => {
    expect(m.issues).toEqual([])
    expect(m.members.map((x) => x.title)).toEqual([
      'CEO',
      'COO',
      'CTO',
      'CFO',
      'PM',
      '개발자',
      'Main 개발자',
      'UI 개발자',
      'DevOps',
      '웹 프론트엔드',
      'QA'
    ])
  })

  it('classifies non-file entries', () => {
    expect(m.members.find((x) => x.title === 'CEO')).toMatchObject({
      kind: 'human',
      fileExists: true
    })
    expect(m.members.find((x) => x.title === 'COO')).toMatchObject({
      kind: 'main-session',
      agentId: null
    })
    expect(m.members.find((x) => x.title === 'CTO')).toMatchObject({
      kind: 'agent',
      agentId: 'cto',
      reportsTo: 'COO'
    })
  })

  it('builds the reporting tree and departments', () => {
    expect(m.tree).toHaveLength(1)
    expect(m.tree[0].member.title).toBe('CEO')
    const coo = m.tree[0].children[0]
    expect(coo.children.map((c) => c.member.title)).toEqual(['CTO', 'CFO', 'PM'])
    expect(coo.children[0].children.map((c) => c.member.title)).toContain('QA')
    expect(m.departments.find((d) => d.name === '개발팀')?.members).toHaveLength(6)
  })

  it('parses the chart block', () => {
    expect(m.chart[0]).toEqual({ label: 'CEO', parent: null, detail: '(사용자)' })
    const cto = m.chart.find((l) => l.label.startsWith('CTO'))
    expect(cto?.parent).toBe('COO')
    expect(cto?.detail).toContain('개발팀')
  })

  it('reports missing agent files', () => {
    const r = parse(
      REAL,
      REAL_AGENTS.filter((a) => a !== 'pm')
    )
    expect(codes(r)).toEqual(['missing-agent-file'])
    expect(r.members.find((x) => x.title === 'PM')?.fileExists).toBe(false)
  })
})

describe('parseOrgDocument (bad input)', () => {
  it('empty file', () => {
    const r = parse('')
    expect(codes(r)).toEqual(['no-table'])
    expect(r.members).toEqual([])
  })

  it('broken table rows are skipped, the rest is parsed', () => {
    const r = parse(
      `${HEAD}| CEO | (사용자) | 경영 | - | 최고 |\n| 깨진 | \`cto\` |\n| | \`pm\` | 기획 | CEO | x |\n| CTO | \`cto\` | R&D | CEO | 기술 |\n`,
      ['cto']
    )
    expect(codes(r)).toEqual(['malformed-row', 'malformed-row'])
    expect(r.members.map((x) => x.title)).toEqual(['CEO', 'CTO'])
    expect(r.issues[0].line).toBe(5)
  })

  it('missing required columns', () => {
    expect(codes(parse('## 직원 목록\n| 이름 | 역할 |\n|---|---|\n| a | b |\n'))).toEqual([
      'missing-columns'
    ])
  })

  it('handles escaped pipes and ignores tables inside code fences', () => {
    const r = parse(`${HEAD}| CEO | (사용자) | 경영 | - | 보고 \\| 결정 |\n`)
    expect(r.members[0].role).toBe('보고 | 결정')
    expect(codes(parse('```\n' + HEAD + '| CEO | (사용자) | a | - | b |\n```\n'))).toEqual([
      'no-table'
    ])
  })

  it('duplicate employees and multiple departments', () => {
    const r = parse(
      `${HEAD}| CEO | (사용자) | 경영 | - | a |\n| CTO | \`cto\` | R&D | CEO | a |\n| CTO2 | \`cto\` | 기획 | CEO | a |\n| CTO | \`pm\` | R&D | CEO | a |\n| 겸직 | \`pm\` | 개발팀, 기획팀 | CEO | a |\n`,
      ['cto', 'pm']
    )
    expect(codes(r)).toEqual([
      'duplicate-employee',
      'multiple-departments',
      'duplicate-employee',
      'multiple-departments'
    ])
    expect(r.members.map((x) => x.title)).toEqual(['CEO', 'CTO', '겸직'])
    expect(r.members[2].department).toBe('개발팀')
  })

  it('cycles are reported and broken', () => {
    const r = parse(
      `${HEAD}| A | \`a\` | d | C | x |\n| B | \`b\` | d | A | x |\n| C | \`c\` | d | B | x |\n| S | \`s\` | d | S | x |\n`,
      ['a', 'b', 'c', 's']
    )
    expect(codes(r)).toEqual(['cycle', 'cycle'])
    expect(r.issues[0].message).toContain('→')
    const count = (n: (typeof r.tree)[number]): number =>
      1 + n.children.reduce((s, c) => s + count(c), 0)
    expect(r.tree.reduce((s, n) => s + count(n), 0)).toBe(4)
  })

  it('unknown and multiple reports-to', () => {
    const r = parse(`${HEAD}| A | \`a\` | d | 없는사람 | x |\n| B | \`b\` | d | A, A | x |\n`, [
      'a',
      'b'
    ])
    expect(codes(r)).toEqual(['unknown-reports-to', 'multiple-reports-to'])
    expect(r.tree.map((n) => n.member.title)).toEqual(['A', 'B'])
  })

  it('rejects path-escape file references', () => {
    const r = parse(
      `${HEAD}| A | \`../../etc/passwd\` | d | - | x |\n| B | \`a/b\` | d | - | x |\n| C | \`..\` | d | - | x |\n| D | cto | d | - | x |\n`,
      ['cto']
    )
    expect(codes(r)).toEqual([
      'invalid-file-ref',
      'invalid-file-ref',
      'invalid-file-ref',
      'invalid-file-ref'
    ])
    expect(r.members.every((x) => x.kind === 'invalid' && x.agentId === null)).toBe(true)
  })

  it('rejects oversized input', () => {
    expect(codes(parse('x'.repeat(MAX_ORG_BYTES + 1)))).toEqual(['file-too-large'])
  })
})

describe('loadOrg / addMember / addDepartment', () => {
  let dir: string
  let fs: SafeFs
  let outside: string
  const put = async (rel: string, text: string): Promise<void> => {
    await mkdir(dirname(join(dir, rel)), { recursive: true })
    await writeFile(join(dir, rel), text)
  }
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mc-org-'))
    outside = await mkdtemp(join(tmpdir(), 'mc-org-out-'))
    await put('company/org.md', REAL)
    for (const a of [...REAL_AGENTS, 'qa-two', 'ops'])
      await put(`.claude/agents/${a}.md`, '---\nname: x\n---\n')
    fs = await SafeFs.open(dir)
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  })

  it('loads the real file against the agents folder', async () => {
    expect((await loadOrg(fs)).issues).toEqual([])
  })

  it('reports a missing or non-regular org.md without throwing', async () => {
    await rm(join(dir, 'company/org.md'))
    expect(codes(await loadOrg(fs))).toEqual(['missing-org'])
    await mkdir(join(dir, 'company/org.md'))
    expect(codes(await loadOrg(fs))).toEqual(['unreadable'])
  })

  it('does not follow a symlinked org.md', async () => {
    await rm(join(dir, 'company/org.md'))
    await symlink(join(dir, 'CLAUDE.md'), join(dir, 'company/org.md'))
    expect(codes(await loadOrg(fs))).toEqual(['unreadable'])
  })

  it('reports agent files that are absent on disk', async () => {
    await rm(join(dir, '.claude/agents/cfo.md'))
    expect(codes(await loadOrg(fs))).toEqual(['missing-agent-file'])
  })

  it('addMember appends a row, preserves the rest and round-trips', async () => {
    const r = await addMember(fs, {
      title: 'QA2',
      agentId: 'qa-two',
      department: '개발팀',
      reportsTo: 'CTO',
      role: '검수 | 보조'
    })
    expect(r.ok).toBe(true)
    const text = await readFile(join(dir, 'company/org.md'), 'utf8')
    const after = REAL.split('\n')
    const expectedRow = text.split('\n').find((l) => l.startsWith('| QA2'))
    expect(expectedRow).toMatch(/^\| QA2 +\| `qa-two` +\| 개발팀 \| CTO +\| 검수 \\\| 보조 +\|$/)
    const rowIdx = after.findIndex((l) => l.startsWith('| QA '))
    after.splice(rowIdx + 1, 0, expectedRow ?? '')
    expect(text).toBe(after.join('\n'))
    const re = await loadOrg(fs)
    expect(re.issues).toEqual([])
    expect(re.members.find((m) => m.title === 'QA2')).toMatchObject({
      agentId: 'qa-two',
      reportsTo: 'CTO',
      role: '검수 | 보조'
    })
    if (r.ok) expect(r.value).toEqual(re)
  })

  it('addDepartment creates the department with its lead and rejects a repeat', async () => {
    const input = {
      name: '운영팀',
      lead: { title: '운영', agentId: 'ops', reportsTo: 'COO', role: '운영' }
    }
    const r = await addDepartment(fs, input)
    expect(r.ok && r.value.departments.find((d) => d.name === '운영팀')?.members).toEqual(['운영'])
    const again = await addDepartment(fs, {
      ...input,
      lead: { ...input.lead, title: '운영2', agentId: 'qa-two' }
    })
    expect(again).toMatchObject({ ok: false, code: 'conflict' })
  })

  it('rejects duplicates, unknown targets, missing files and unsafe input', async () => {
    const base = {
      title: 'N',
      agentId: 'qa-two',
      department: '개발팀',
      reportsTo: 'CTO',
      role: 'r'
    }
    const before = await readFile(join(dir, 'company/org.md'), 'utf8')
    expect(await addMember(fs, { ...base, title: 'CTO' })).toMatchObject({ code: 'conflict' })
    expect(await addMember(fs, { ...base, agentId: 'cto' })).toMatchObject({ code: 'conflict' })
    expect(await addMember(fs, { ...base, reportsTo: '유령' })).toMatchObject({
      code: 'invalid-request'
    })
    expect(await addMember(fs, { ...base, agentId: 'nofile' })).toMatchObject({
      code: 'invalid-request'
    })
    for (const agentId of ['../x', 'a/b', '..', 'A B', '']) {
      expect(await addMember(fs, { ...base, agentId })).toMatchObject({ code: 'invalid-request' })
    }
    expect(await addMember(fs, { ...base, title: 'a|b' })).toMatchObject({
      code: 'invalid-request'
    })
    expect(await addMember(fs, { ...base, department: 'a\nb' })).toMatchObject({
      code: 'invalid-request'
    })
    expect(await addMember(fs, { ...base, role: 'a\nb' })).toMatchObject({
      code: 'invalid-request'
    })
    expect(await addMember(fs, { ...base, department: '두,부서' })).toMatchObject({
      code: 'invalid-request'
    })
    expect(await readFile(join(dir, 'company/org.md'), 'utf8')).toBe(before)
  })

  it('preserves CRLF line endings and refuses when there is no table', async () => {
    await put('company/org.md', REAL.replace(/\n/g, '\r\n'))
    expect(
      (
        await addMember(fs, {
          title: 'N',
          agentId: 'qa-two',
          department: '개발팀',
          reportsTo: 'CTO',
          role: 'r'
        })
      ).ok
    ).toBe(true)
    const text = await readFile(join(dir, 'company/org.md'), 'utf8')
    expect(text.replace(/\r\n/g, '')).not.toContain('\n')
    await put('company/org.md', '')
    expect(
      await addMember(fs, {
        title: 'N',
        agentId: 'qa-two',
        department: 'd',
        reportsTo: 'CTO',
        role: 'r'
      })
    ).toMatchObject({ ok: false })
  })

  it('serializes concurrent additions without losing rows', async () => {
    const mk = (title: string, agentId: string): Promise<ApiResult<OrgModel>> =>
      addMember(fs, { title, agentId, department: '개발팀', reportsTo: 'CTO', role: 'r' })
    const rs = await Promise.all([mk('N1', 'qa-two'), mk('N2', 'ops')])
    expect(rs.every((r) => r.ok)).toBe(true)
    const re = await loadOrg(fs)
    expect(re.members.map((m) => m.title)).toEqual(expect.arrayContaining(['N1', 'N2']))
  })

  it('rejects names that normalize differently or mean "none"', async () => {
    const base = {
      title: 'N',
      agentId: 'qa-two',
      department: '개발팀',
      reportsTo: 'CTO',
      role: 'r'
    }
    const before = await readFile(join(dir, 'company/org.md'), 'utf8')
    for (const bad of [
      { title: 'CTO ' },
      { title: ' N' },
      { title: '   ' },
      { title: '-' },
      { title: 'a/b' },
      { title: 'a,b' },
      { title: 'a\u2028b' },
      { title: 'a\u0085b' },
      { department: ' ' },
      { department: '-' },
      { department: '개발팀 ' },
      { reportsTo: 'CTO ' },
      { role: 'a\u2029b' },
      { role: 'x'.repeat(301) },
      { role: ' r' },
      { role: 'r ' }
    ])
      expect(await addMember(fs, { ...base, ...bad }), JSON.stringify(bad)).toMatchObject({
        ok: false,
        code: 'invalid-request'
      })
    expect(await readFile(join(dir, 'company/org.md'), 'utf8')).toBe(before)
  })

  it('refuses a row the parser would silently drop (over 500 rows)', async () => {
    const uniq = Array.from({ length: 500 }, (_, i) => `| P${i} | (사용자) | d | - | x |`)
    await put('company/org.md', `${HEAD}${uniq.join('\n')}\n`)
    const r = await addMember(fs, {
      title: 'N',
      agentId: 'qa-two',
      department: 'd',
      reportsTo: 'P0',
      role: 'r'
    })
    expect(r).toMatchObject({ ok: false, code: 'invalid-request' })
    expect((await loadOrg(fs)).members).toHaveLength(500)
  })

  it('round-trips backslashes and escaped pipes in cells', async () => {
    const roles = ['a\\b', 'x\\', 'a\\|b', '\\\\']
    for (const [i, role] of roles.entries()) {
      await put(`.claude/agents/b${i}.md`, 'x')
      const before = await loadOrg(fs)
      const r = await addMember(fs, {
        title: `B${i}`,
        agentId: `b${i}`,
        department: '개발팀',
        reportsTo: 'CTO',
        role
      })
      expect(r.ok, role).toBe(true)
      const re = await loadOrg(fs)
      expect(re.issues).toEqual([])
      expect(re.members).toHaveLength(before.members.length + 1)
      expect(re.members.find((m) => m.title === `B${i}`)?.role).toBe(role)
    }
    // 이스케이프된 행은 열이 늘지 않고 한 줄·다섯 셀로 남는다.
    const line = (await readFile(join(dir, 'company/org.md'), 'utf8'))
      .split('\n')
      .find((l) => l.startsWith('| B2'))
    expect(line?.replace(/\\./g, '').split('|')).toHaveLength(7)
  })

  it('allows an addition that resolves an existing unknown-reports-to', async () => {
    await put('company/org.md', `${HEAD}| A | \`cto\` | d | 나중 | x |\n`)
    expect(codes(await loadOrg(fs))).toEqual(['unknown-reports-to'])
    const r = await addMember(fs, {
      title: '나중',
      agentId: 'pm',
      department: 'd',
      reportsTo: 'A',
      role: 'r'
    })
    expect(r.ok).toBe(false) // 보고 대상 A가 나중을 가리키므로 순환이 새로 생겨 거부된다
    await put(
      'company/org.md',
      `${HEAD}| A | \`cto\` | d | - | x |\n| B | \`cfo\` | d | 나중 | x |\n`
    )
    const ok = await addMember(fs, {
      title: '나중',
      agentId: 'pm',
      department: 'd',
      reportsTo: 'A',
      role: 'r'
    })
    expect(ok.ok).toBe(true)
    expect(await loadOrg(fs)).toMatchObject({ issues: [] })
  })

  it('retries once when org.md changes before the write, then reports conflict', async () => {
    const input = {
      title: 'R',
      agentId: 'qa-two',
      department: '개발팀',
      reportsTo: 'CTO',
      role: 'r'
    }
    const flaky = (changeOnCalls: number[]): SafeFs => {
      let calls = 0
      const w = Object.create(fs) as SafeFs
      w.readText = async (rel: string): Promise<string> => {
        const text = await fs.readText(rel)
        return changeOnCalls.includes(++calls) ? `${text}\n<!-- 동시 편집 -->` : text
      }
      return w
    }
    const once = await addMember(flaky([2]), input)
    expect(once.ok).toBe(true)
    const before = await readFile(join(dir, 'company/org.md'), 'utf8')
    const twice = await addMember(flaky([2, 4]), { ...input, title: 'R2', agentId: 'ops' })
    expect(twice).toMatchObject({ ok: false, code: 'conflict' })
    expect(await readFile(join(dir, 'company/org.md'), 'utf8')).toBe(before)
  })

  it('concurrent additions keep every row exactly once', async () => {
    const ids = Array.from({ length: 8 }, (_, i) => `w${i}`)
    for (const id of ids) await put(`.claude/agents/${id}.md`, 'x')
    const rs = await Promise.all(
      ids.map((id) =>
        addMember(fs, {
          title: id.toUpperCase(),
          agentId: id,
          department: '개발팀',
          reportsTo: 'CTO',
          role: 'r'
        })
      )
    )
    expect(rs.every((r) => r.ok)).toBe(true)
    const re = await loadOrg(fs)
    expect(re.issues).toEqual([])
    expect(re.members).toHaveLength(11 + ids.length)
    expect(new Set(re.members.map((m) => m.title)).size).toBe(re.members.length)
  })

  it('concurrent additions of the same title or agent: only one wins', async () => {
    const mk = (title: string, agentId: string): Promise<ApiResult<OrgModel>> =>
      addMember(fs, { title, agentId, department: '개발팀', reportsTo: 'CTO', role: 'r' })
    const sameTitle = await Promise.all([mk('Z', 'qa-two'), mk('Z', 'ops')])
    expect(sameTitle.filter((r) => r.ok)).toHaveLength(1)
    await put('.claude/agents/w1.md', 'x')
    const sameAgent = await Promise.all([mk('Y1', 'w1'), mk('Y2', 'w1')])
    expect(sameAgent.filter((r) => r.ok)).toHaveLength(1)
    const re = await loadOrg(fs)
    expect(re.issues).toEqual([])
  })

  it('addMember on a document with a cycle still works and keeps the cycle issue', async () => {
    await put('company/org.md', `${HEAD}| A | \`cto\` | d | B | x |\n| B | \`cfo\` | d | A | x |\n`)
    const r = await addMember(fs, {
      title: 'C',
      agentId: 'pm',
      department: 'd',
      reportsTo: 'A',
      role: 'r'
    })
    expect(r.ok).toBe(true)
    expect(codes(await loadOrg(fs))).toEqual(['cycle'])
  })

  it('loadOrg reports oversize org.md and a symlinked agents folder', async () => {
    await put('company/org.md', `${HEAD}${'<!-- x -->\n'.repeat(30000)}`)
    expect(codes(await loadOrg(fs))).toEqual(['file-too-large'])
    await put('company/org.md', REAL)
    await rm(join(dir, '.claude/agents'), { recursive: true })
    await mkdir(join(outside, 'agents'))
    await symlink(join(outside, 'agents'), join(dir, '.claude/agents'))
    expect(codes(await loadOrg(fs))).toContain('unreadable')
    expect(
      await addMember(fs, {
        title: 'N',
        agentId: 'qa-two',
        department: 'd',
        reportsTo: 'CTO',
        role: 'r'
      })
    ).toMatchObject({ ok: false, code: 'internal' })
  })
})

describe('parser hardening', () => {
  it('long whitespace lines do not cause catastrophic backtracking', () => {
    const t0 = Date.now()
    parse('## 조직도\n```\na' + ' '.repeat(100_000) + 'b\n```\n')
    parse(
      '## 직원 목록\n| 직급 | 직원 파일 |\n|' +
        ' '.repeat(100_000) +
        '-' +
        ' '.repeat(100_000) +
        'x\n'
    )
    parse(`${HEAD}|${' '.repeat(100_000)}\n`)
    expect(Date.now() - t0).toBeLessThan(2000)
  })

  it('over-long cells and control characters are malformed rows', () => {
    const r = parse(
      `${HEAD}| A | (사용자) | d | - | ${'x'.repeat(301)} |\n| B | (사용자) | d | - | a\u0007b |\n| C | (사용자) | d | - | ok |\n`
    )
    expect(codes(r)).toEqual(['malformed-row', 'malformed-row'])
    expect(r.members.map((m) => m.title)).toEqual(['C'])
  })
})
