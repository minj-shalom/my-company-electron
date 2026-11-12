import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FileCompanyRepository } from './file-repository'

let dir: string
let outside: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mc-repo-'))
  outside = await mkdtemp(join(tmpdir(), 'mc-outside-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
  await rm(outside, { recursive: true, force: true })
})

async function put(rel: string, content: string): Promise<void> {
  const abs = join(dir, rel)
  await mkdir(dirname(abs), { recursive: true })
  await writeFile(abs, content)
}

const ORG = `# 조직도
## 직원 목록
| 직급 | 직원 파일 | 부서 | 보고 대상 | 역할 |
|---|---|---|---|---|
| CEO | (사용자) | 경영 | - | 결정 |
| COO | \`CLAUDE.md\` (메인 세션) | 경영 | CEO | 하달 |
| CTO | \`cto\` | R&D | COO | 기술 |
| 개발자 | \`developer\` | 개발팀 | CTO | 구현 |
| 유령 | \`ghost\` | 개발팀 | CTO | 없음 |
`
const agent = (n: string): string =>
  `---\nname: ${n}\ndescription: ${n} 설명\nmodel: sonnet\n---\n\n# ${n}\n`

const TICKET = `# T-005: 로더

- **상태:** in-progress
- **담당:** electron-main-dev
- **브랜치:** feature/T-005

## 목표
x
`

const DECISION = `# D-009: 푸시 컨펌

- **관련 티켓:** T-005
- **작성일:** 2026-11-12
- **상태:** pending

## 질문
푸시할까요?

## 선택지
1. **A. 푸시 + PR 생성** — 머지는 별도
2. **B. 보류** — 로컬에만 둔다.

## 추천안과 이유
- 추천: A (필요해지면 B)

## 결정 (사람이 작성)
- 선택:
- 메모:
`

describe('employees and org', () => {
  it('merges agent files with org.md rows and reports problems', async () => {
    await put('company/org.md', ORG)
    await put('.claude/agents/cto.md', agent('cto'))
    await put('.claude/agents/developer.md', agent('developer'))
    await put('.claude/agents/broken.md', '---\nname: [oops\n---\n')
    await put('.claude/agents/nodesc.md', '---\nname: x\n---\n')
    const repo = await FileCompanyRepository.open(dir)
    const { org, issues } = await repo.listEmployees()
    const dev = org.employees.find((e) => e.id === 'developer')
    expect(dev).toMatchObject({
      title: '개발자',
      department: '개발팀',
      reportsTo: 'cto',
      model: 'sonnet'
    })
    expect(org.employees.find((e) => e.id === 'cto')?.reportsTo).toBeNull()
    expect(org.departments.find((d) => d.name === '개발팀')?.employeeIds).toEqual(['developer'])
    expect(issues.map((i) => i.path).sort()).toEqual(
      ['.claude/agents/broken.md', '.claude/agents/nodesc.md', 'company/org.md'].sort()
    )
    expect(issues.find((i) => i.message.includes('ghost'))).toBeTruthy()
  })

  it('saves an employee file as markdown and keeps body on update', async () => {
    const repo = await FileCompanyRepository.open(dir)
    const r = await repo.saveEmployee({
      id: 'qa-bot',
      name: 'QA',
      description: '검수: 읽기 전용',
      body: '# QA\n규칙'
    })
    expect(r.ok).toBe(true)
    const text = await readFile(join(dir, '.claude/agents/qa-bot.md'), 'utf8')
    expect(text).toContain('description: "검수: 읽기 전용"')
    await repo.saveEmployee({ id: 'qa-bot', name: 'QA2', description: 'd' })
    expect(await readFile(join(dir, '.claude/agents/qa-bot.md'), 'utf8')).toContain('규칙')
  })

  it('rejects bad employee ids', async () => {
    const repo = await FileCompanyRepository.open(dir)
    for (const id of ['../x', 'A', 'a/b', '', '.hidden']) {
      const r = await repo.saveEmployee({ id, name: 'n', description: 'd' })
      expect(r).toMatchObject({ ok: false, code: 'invalid-request' })
    }
    expect((await repo.getEmployee('../x')).ok).toBe(false)
  })
})

describe('saveEmployee safety', () => {
  it('does not overwrite an unreadable existing file and preserves unknown keys', async () => {
    const broken = '---\nname: [oops\n---\n중요한 본문\n'
    await put('.claude/agents/qa.md', broken)
    const repo = await FileCompanyRepository.open(dir)
    expect((await repo.saveEmployee({ id: 'qa', name: 'n', description: 'd' })).ok).toBe(false)
    expect(await readFile(join(dir, '.claude/agents/qa.md'), 'utf8')).toBe(broken)

    await put('.claude/agents/big.md', 'x'.repeat(1024 * 1024 + 1))
    expect((await repo.saveEmployee({ id: 'big', name: 'n', description: 'd' })).ok).toBe(false)

    await put('.claude/agents/ok.md', '---\nname: a\ndescription: d\ncolor: red\n---\n본문\n')
    await repo.saveEmployee({ id: 'ok', name: 'b', description: 'e' })
    const text = await readFile(join(dir, '.claude/agents/ok.md'), 'utf8')
    expect(text).toContain('color: red')
    expect(text).toContain('본문')
  })
})

describe('tickets', () => {
  it('lists across folders, folder is the status, bad files become issues', async () => {
    await put('company/tickets/in-progress/T-005-loader.md', TICKET)
    await put('company/tickets/backlog/T-006-x.md', '# T-006: 다음\n- **담당:** ui-dev\n')
    await put('company/tickets/backlog/notes.md', '# 메모\n')
    await put('company/tickets/done/T-001-a.md', '---\ntitle: [bad\n---\n')
    const repo = await FileCompanyRepository.open(dir)
    const { items, issues } = await repo.listTickets()
    expect(items.map((t) => [t.id, t.status, t.assignee])).toEqual([
      ['T-005', 'in-progress', 'electron-main-dev'],
      ['T-006', 'backlog', 'ui-dev']
    ])
    expect(items[0].title).toBe('로더')
    expect(issues).toHaveLength(2)
    expect((await repo.listTickets('done')).items).toEqual([])
  })

  it('getTicket validates id format', async () => {
    const repo = await FileCompanyRepository.open(dir)
    expect(await repo.getTicket('../../etc/passwd')).toMatchObject({
      ok: false,
      code: 'invalid-request'
    })
    expect(await repo.getTicket('T-9')).toMatchObject({ ok: false, code: 'not-found' })
  })

  it('moves a ticket: writes new markdown first, updates status line, removes old', async () => {
    await put('company/tickets/in-progress/T-005-loader.md', TICKET)
    const repo = await FileCompanyRepository.open(dir)
    const r = await repo.moveTicket('T-005', 'done')
    expect(r).toMatchObject({ ok: true, value: { status: 'done' } })
    expect(existsSync(join(dir, 'company/tickets/in-progress/T-005-loader.md'))).toBe(false)
    expect(await readFile(join(dir, 'company/tickets/done/T-005-loader.md'), 'utf8')).toContain(
      '**상태:** done'
    )
    expect(await repo.moveTicket('T-005', 'nope' as never)).toMatchObject({ ok: false })
    expect(await repo.moveTicket('T-404', 'done')).toMatchObject({ ok: false, code: 'not-found' })
  })
})

describe('move recovery and conflicts', () => {
  it('conflicts when a different file already exists at the target', async () => {
    await put('company/tickets/in-progress/T-005-loader.md', TICKET)
    await put('company/tickets/done/T-005-loader.md', '# T-005: 다른 내용\n')
    const repo = await FileCompanyRepository.open(dir)
    expect(await repo.moveTicket('T-005', 'done')).toMatchObject({ ok: false, code: 'conflict' })
    expect(existsSync(join(dir, 'company/tickets/in-progress/T-005-loader.md'))).toBe(true)
  })

  it('recovers a half-finished move when the target has identical content', async () => {
    await put('company/tickets/in-progress/T-005-loader.md', TICKET)
    await put('company/tickets/done/T-005-loader.md', TICKET.replace('in-progress', 'done'))
    const repo = await FileCompanyRepository.open(dir)
    expect((await repo.listTickets()).items).toHaveLength(2) // 중복이 그대로 드러난다
    expect(await repo.moveTicket('T-005', 'done')).toMatchObject({ ok: true })
    expect((await repo.listTickets()).items).toHaveLength(1)
    expect(existsSync(join(dir, 'company/tickets/in-progress/T-005-loader.md'))).toBe(false)
  })

  it('rolls back the new file when the old one cannot be removed', async () => {
    await put('company/tickets/in-progress/T-005-loader.md', TICKET)
    const repo = await FileCompanyRepository.open(dir)
    const inner = (repo as unknown as { fs: { remove: (p: string) => Promise<void> } }).fs
    const orig = inner.remove.bind(inner)
    let first = true
    inner.remove = async (p: string) => {
      if (first) {
        first = false
        throw new Error('EACCES')
      }
      return orig(p)
    }
    expect((await repo.moveTicket('T-005', 'done')).ok).toBe(false)
    expect(existsSync(join(dir, 'company/tickets/done/T-005-loader.md'))).toBe(false)
    expect(existsSync(join(dir, 'company/tickets/in-progress/T-005-loader.md'))).toBe(true)
  })
})

describe('decisions', () => {
  it('parses options, recommended and ticket link', async () => {
    await put('company/decisions/pending/D-009-push.md', DECISION)
    const repo = await FileCompanyRepository.open(dir)
    const { items } = await repo.listDecisions('pending')
    expect(items[0]).toMatchObject({
      id: 'D-009',
      ticketId: 'T-005',
      recommended: 'A',
      chosen: null,
      title: '푸시 컨펌'
    })
    expect(items[0].options).toEqual([
      { key: 'A', label: '푸시 + PR 생성', description: '머지는 별도' },
      { key: 'B', label: '보류', description: '로컬에만 둔다.' }
    ])
  })

  it('resolves: validates choice/memo, writes done card first, then removes pending', async () => {
    await put('company/decisions/pending/D-009-push.md', DECISION)
    const repo = await FileCompanyRepository.open(dir)
    expect(await repo.resolveDecision({ id: 'D-009', choice: 'Z' })).toMatchObject({
      ok: false,
      code: 'invalid-request'
    })
    expect(
      await repo.resolveDecision({ id: 'D-009', choice: 'A', memo: 'x'.repeat(2001) })
    ).toMatchObject({ ok: false })
    expect(await repo.resolveDecision({ id: '../D-009', choice: 'A' })).toMatchObject({ ok: false })
    const r = await repo.resolveDecision({ id: 'D-009', choice: 'A', memo: '첫 줄\n둘째 줄' })
    expect(r).toMatchObject({
      ok: true,
      value: { status: 'done', chosen: 'A', memo: '첫 줄\n둘째 줄' }
    })
    expect(existsSync(join(dir, 'company/decisions/pending/D-009-push.md'))).toBe(false)
    const text = await readFile(join(dir, 'company/decisions/done/D-009-push.md'), 'utf8')
    expect(text).toContain('**상태:** done')
    expect(await repo.resolveDecision({ id: 'D-009', choice: 'A' })).toMatchObject({
      ok: false,
      code: 'conflict'
    })
  })

  it('extracts chosen from free-form text in done cards', async () => {
    await put('company/decisions/done/D-004-x.md', DECISION.replace('- 선택:', '- 선택: B (보류)'))
    const repo = await FileCompanyRepository.open(dir)
    expect((await repo.listDecisions('done')).items[0].chosen).toBe('B')
  })
})

describe('reports', () => {
  it('lists, creates without overwriting', async () => {
    await put('company/reports/T-001-init.md', '# 보고서: T-001 초기화\n')
    const repo = await FileCompanyRepository.open(dir)
    expect((await repo.listReports()).items[0]).toMatchObject({
      id: 'T-001-init',
      title: 'T-001 초기화',
      ticketId: 'T-001'
    })
    expect(await repo.createReport('T-001-init', '# 다시')).toMatchObject({
      ok: false,
      code: 'conflict'
    })
    expect(await repo.createReport('T-005-loader', '# 보고서: T-005 로더\n')).toMatchObject({
      ok: true
    })
    expect(await repo.createReport('../evil', '# x')).toMatchObject({
      ok: false,
      code: 'invalid-request'
    })
    expect(await repo.createReport('no-title', 'body only')).toMatchObject({ ok: false })
  })
})

describe('path safety', () => {
  it('skips symlinked files and refuses symlinked directories', async () => {
    await writeFile(join(outside, 'T-099-evil.md'), '# T-099: evil\n')
    await mkdir(join(dir, 'company/tickets/backlog'), { recursive: true })
    await symlink(
      join(outside, 'T-099-evil.md'),
      join(dir, 'company/tickets/backlog/T-099-evil.md')
    )
    const repo = await FileCompanyRepository.open(dir)
    const r = await repo.listTickets()
    expect(r.items).toEqual([])
    expect(r.issues).toHaveLength(1)

    await rm(join(dir, 'company/tickets/backlog'), { recursive: true })
    await symlink(outside, join(dir, 'company/tickets/backlog'))
    const linked = await repo.listTickets('backlog')
    expect(linked.items).toEqual([])
    expect(linked.issues).toHaveLength(1)
    expect(JSON.stringify(linked.issues)).not.toContain(outside)
  })

  it('does not write through a symlinked directory', async () => {
    await mkdir(join(dir, 'company'), { recursive: true })
    await symlink(outside, join(dir, 'company/reports'))
    const repo = await FileCompanyRepository.open(dir)
    expect(await repo.createReport('T-001-x', '# 보고서: t')).toMatchObject({ ok: false })
    expect(existsSync(join(outside, 'T-001-x.md'))).toBe(false)
  })

  it('does not leak absolute paths in messages', async () => {
    const repo = await FileCompanyRepository.open(dir)
    const r = await repo.getCompany()
    expect(r.ok).toBe(true)
    await put('.claude/agents/bad.md', '---\nname: [x\n---\n')
    const { issues } = await repo.listEmployees()
    expect(JSON.stringify(issues)).not.toContain(dir)
  })
})

describe('company info', () => {
  it('reads mission when present', async () => {
    await put('company/mission.md', '# 미션\n')
    const repo = await FileCompanyRepository.open(dir)
    expect(await repo.getCompany()).toMatchObject({ ok: true, value: { mission: '# 미션\n' } })
  })
})

// 실제 회사 폴더는 읽기 전용 샘플이다. 라이브 데이터는 바뀌므로 개별 값이 아니라 형태만 확인한다.
const SAMPLE = join(__dirname, '../../../../my-company-cli')
describe.skipIf(!existsSync(join(SAMPLE, 'company/org.md')))(
  'real company folder (read-only)',
  () => {
    it('parses without throwing and finds employees, tickets, decisions', async () => {
      const repo = await FileCompanyRepository.open(SAMPLE)
      const emp = await repo.listEmployees()
      expect(emp.org.employees.length).toBeGreaterThan(0)
      expect(emp.org.employees.every((e) => e.description.length > 0)).toBe(true)
      expect((await repo.listTickets()).items.length).toBeGreaterThan(0)
      const d = await repo.listDecisions()
      expect(d.items.every((x) => x.options.length > 0 || x.status === 'done')).toBe(true)
      await repo.listReports()
    })
  }
)
