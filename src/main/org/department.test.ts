import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { validateDepartmentName } from '../../shared/department'
import { CompanyContext } from '../company/company-context'
import { createDomainHandlers } from '../domain-ipc'
import { makeCompany, put, type TestCompany } from '../employee/test-company'
import { ProviderService } from '../providers/provider-service'
import type { SafeFs } from '../repository/safe-fs'
import { createWeeklyLimitsStore } from '../settings/weekly-limits-store'
import { DepartmentService } from './department-service'
import { removeDepartment, renameDepartment } from './department-store'
import { addMember, loadOrg } from './org-store'

const dirs: string[] = []
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
})

async function setup(): Promise<{
  c: TestCompany
  svc: DepartmentService
  org: () => Promise<string>
}> {
  const c = await makeCompany()
  dirs.push(c.dir)
  const svc = new DepartmentService({
    fs: c.fs,
    exclusive: (t) => c.repo.runExclusive(t),
    isApproved: async (id) => {
      const d = await c.repo.getDecision(id)
      return d.ok && d.value.status === 'done' && d.value.chosen !== null
    },
    now: () => new Date('2026-11-13T00:00:00Z')
  })
  return { c, svc, org: () => readFile(join(c.dir, 'company/org.md'), 'utf8') }
}

describe('validateDepartmentName', () => {
  it('accepts normal names, including the existing ones', () => {
    for (const n of ['콘텐츠팀', 'R&D', 'Design 2', '인사팀', '가'.repeat(30)])
      expect(validateDepartmentName(n)).toBeNull()
  })
  it.each([
    '',
    ' a',
    'a ',
    '가'.repeat(31),
    'a|b',
    'a\nb',
    'a\u0000b',
    'a​b',
    'a b',
    'a`b',
    '*bold*',
    '# h',
    '[x]',
    '<b>',
    'a_b',
    'a\\b',
    '개발팀 (x)',
    '개발 ── 팀',
    '│팀',
    '├팀',
    '-',
    '-팀',
    ':--',
    'a,b',
    'a/b',
    'CEO',
    'ｃｏｏ',
    '조직도',
    '직원 목록',
    123 as unknown as string
  ])('rejects %j', (n) => {
    expect(validateDepartmentName(n)).not.toBeNull()
  })
})

describe('renameDepartment', () => {
  it('rewrites rows and the chart block in one write and round-trips', async () => {
    const { c, org } = await setup()
    const original = await org()
    const r = await renameDepartment(c.fs, '개발팀', '제품팀')
    expect(r.ok).toBe(true)
    const renamed = await org()
    expect(renamed).not.toContain('개발팀')
    expect(renamed).toContain('CTO ── 제품팀 (developer')
    expect(renamed.split('\n').filter((l) => l.includes('제품팀'))).toHaveLength(7)
    const model = await loadOrg(c.fs)
    expect(model.issues).toEqual([])
    expect(model.departments.find((d) => d.name === '제품팀')?.members).toHaveLength(6)
    // 다른 줄은 바이트 그대로다.
    const changed = original.split('\n').filter((l, i) => l !== renamed.split('\n')[i])
    expect(changed).toHaveLength(7)
    expect((await renameDepartment(c.fs, '제품팀', '개발팀')).ok).toBe(true)
    expect(await org()).toBe(original)
  })

  it('renames a department that is only a plain chart label line', async () => {
    const { c, org } = await setup()
    expect((await renameDepartment(c.fs, '기획팀', '전략팀')).ok).toBe(true)
    expect(await org()).toContain('└─ 전략팀 (pm)')
  })

  it('rejects duplicates, reserved and invalid names without touching the file', async () => {
    const { c, org } = await setup()
    const before = await org()
    const cases: Array<[string, string, string]> = [
      ['개발팀', '기획팀', 'conflict'],
      ['개발팀', ' 기획팀', 'invalid-request'],
      ['개발팀', 'ｃｏｏ', 'invalid-request'],
      ['개발팀', 'a|b', 'invalid-request'],
      ['개발팀', '개발팀', 'invalid-request'],
      ['없는팀', '새팀', 'not-found']
    ]
    for (const [from, to, code] of cases)
      expect(await renameDepartment(c.fs, from, to), `${from}->${to}`).toMatchObject({
        ok: false,
        code
      })
    expect(await org()).toBe(before)
  })

  it('leaves the file unchanged when the chart block cannot be rewritten', async () => {
    const { c, org } = await setup()
    // 닫히지 않은 코드 펜스: 블록 구조를 알 수 없다.
    const broken = (await org()).replace('     └─ 기획팀 (pm)\n```', '     └─ 기획팀 (pm)\n')
    await put(c.dir, 'company/org.md', broken)
    expect(await renameDepartment(c.fs, '개발팀', '제품팀')).toMatchObject({ ok: false })
    expect(await org()).toBe(broken)
  })

  it('leaves the file unchanged when the write itself fails', async () => {
    const { c, org } = await setup()
    const before = await org()
    const failing = Object.create(c.fs) as SafeFs
    failing.writeText = async () => {
      throw new Error('disk full at /secret/path')
    }
    const r = await renameDepartment(failing, '개발팀', '제품팀')
    expect(r).toMatchObject({ ok: false, code: 'internal' })
    expect(JSON.stringify(r)).not.toContain('/secret')
    expect(await org()).toBe(before)
  })

  it('preserves CRLF line endings', async () => {
    const { c, org } = await setup()
    const crlf = (await org()).replace(/\n/g, '\r\n')
    await put(c.dir, 'company/org.md', crlf)
    expect((await renameDepartment(c.fs, '개발팀', '제품팀')).ok).toBe(true)
    const after = await org()
    expect(after).not.toMatch(/[^\r]\n/)
    expect((await loadOrg(c.fs)).issues).toEqual([])
  })
})

describe('removeDepartment', () => {
  it('refuses a department that still has employees and explains what to do', async () => {
    const { c, org } = await setup()
    const before = await org()
    const r = await removeDepartment(c.fs, '개발팀')
    expect(r).toMatchObject({ ok: false, code: 'conflict' })
    expect(!r.ok && r.message).toMatch(/이동|퇴사/)
    expect(await org()).toBe(before)
  })

  it('removes an empty department from the chart and repairs the tree shape', async () => {
    const { c, org } = await setup()
    const withEmpty = (await org()).replace(
      '     └─ 기획팀 (pm)\n',
      '     ├─ 기획팀 (pm)\n     └─ 콘텐츠팀\n'
    )
    await put(c.dir, 'company/org.md', withEmpty)
    const r = await removeDepartment(c.fs, '콘텐츠팀')
    expect(r.ok).toBe(true)
    const after = await org()
    expect(after).not.toContain('└─ 콘텐츠팀')
    expect(after).toContain('     └─ 기획팀 (pm)\n')
    expect(after).not.toContain('├─ 기획팀')
    expect((await loadOrg(c.fs)).issues).toEqual([])
    expect(await removeDepartment(c.fs, '콘텐츠팀')).toMatchObject({ ok: false, code: 'not-found' })
  })

  it('strips only the department text from a title line', async () => {
    const { c, org } = await setup()
    const text = (await org()).replace(
      '     └─ 기획팀 (pm)\n',
      '     ├─ 기획팀 (pm)\n     └─ COO ── 법무팀\n'
    )
    await put(c.dir, 'company/org.md', text)
    expect((await removeDepartment(c.fs, '법무팀')).ok).toBe(true)
    expect(await org()).toContain('└─ COO\n')
  })
})

describe('DepartmentService', () => {
  it('adds a department by moving an already hired employee, as ceo-ui', async () => {
    const { c, svc, org } = await setup()
    const r = await svc.add({ name: '콘텐츠팀', leadId: 'pm' }, 'ceo-ui')
    expect(r).toEqual({
      ok: true,
      value: {
        record: {
          action: 'add',
          department: '콘텐츠팀',
          newName: null,
          affectedEmployeeIds: ['pm'],
          actor: 'ceo-ui',
          approval: null,
          sensitive: false,
          sensitiveReasons: [],
          files: ['company/org.md'],
          at: '2026-11-13T00:00:00.000Z'
        }
      }
    })
    expect(await org()).toContain('콘텐츠팀 (pm)')
    const model = await loadOrg(c.fs)
    expect(model.issues).toEqual([])
    expect(model.departments.map((d) => d.name)).not.toContain('기획팀')
  })

  it('rejects duplicate, invalid, unknown and protected leads', async () => {
    const { svc, org } = await setup()
    const before = await org()
    const code = async (raw: unknown): Promise<string | undefined> => {
      const r = await svc.add(raw, 'ceo-ui')
      return r.ok ? undefined : r.code
    }
    expect(await code({ name: '기획팀', leadId: 'developer' })).toBe('conflict')
    expect(await code({ name: 'a|b', leadId: 'developer' })).toBe('invalid-request')
    expect(await code({ name: '새팀', leadId: 'nobody' })).toBe('not-found')
    expect(await code({ name: '새팀', leadId: 'developer', actor: 'approved-proposal' })).toBe(
      'invalid-request'
    )
    expect(await code({ name: '새팀', leadId: '../x' })).toBe('invalid-request')
    expect(await org()).toBe(before)
  })

  it('needs an approved card to move or rename around cto, cfo, hr', async () => {
    const { svc, org } = await setup()
    const before = await org()
    expect(await svc.add({ name: '새팀', leadId: 'cto' }, 'ceo-ui')).toMatchObject({
      code: 'approval-required'
    })
    expect(await svc.rename({ from: 'R&D', to: '연구팀' }, 'ceo-ui')).toMatchObject({
      code: 'approval-required'
    })
    expect(
      await svc.rename({ from: 'R&D', to: '연구팀', approval: 'D-016' }, 'ceo-ui')
    ).toMatchObject({ code: 'approval-required' })
    expect(await org()).toBe(before)
    const ok = await svc.rename(
      { from: 'R&D', to: '연구팀', approval: 'D-012' },
      'approved-proposal'
    )
    expect(ok).toMatchObject({
      ok: true,
      value: {
        record: {
          actor: 'approved-proposal',
          approval: 'D-012',
          sensitive: true,
          sensitiveReasons: ['protected-role'],
          newName: '연구팀',
          affectedEmployeeIds: ['cto']
        }
      }
    })
  })

  it('forbids renaming the department of COO and CEO even with approval', async () => {
    const { svc } = await setup()
    expect(
      await svc.rename({ from: '경영', to: '경영팀', approval: 'D-012' }, 'ceo-ui')
    ).toMatchObject({ ok: false, code: 'forbidden' })
  })

  it('renames the department of a hired employee and keeps assignments by id', async () => {
    const { c, svc, org } = await setup()
    await put(c.dir, '.claude/agents/writer.md', '---\nname: writer\n---\n')
    expect(
      (
        await addMember(c.fs, {
          title: '작가',
          agentId: 'writer',
          department: '콘텐츠팀',
          reportsTo: 'COO',
          role: '글쓰기'
        })
      ).ok
    ).toBe(true)
    const r = await svc.rename({ from: '콘텐츠팀', to: '편집팀' }, 'ceo-ui')
    expect(r).toMatchObject({ ok: true, value: { record: { affectedEmployeeIds: ['writer'] } } })
    expect(await org()).toContain('편집팀 (writer)')
  })

  it('rejects an invalid actor and never exposes internal paths in failures', async () => {
    const { c, svc } = await setup()
    expect(await svc.remove({ name: '개발팀' }, 'nobody' as never)).toMatchObject({
      code: 'invalid-request'
    })
    await rm(join(c.dir, 'company/org.md'))
    const r = await svc.rename({ from: '개발팀', to: '제품팀' }, 'ceo-ui')
    expect(r.ok).toBe(false)
    expect(JSON.stringify(r)).not.toContain(c.dir)
  })

  it('serializes with other writers (concurrent renames never corrupt the file)', async () => {
    const { c, svc } = await setup()
    const rs = await Promise.all([
      svc.rename({ from: '개발팀', to: '제품팀' }, 'ceo-ui'),
      svc.rename({ from: '개발팀', to: '플랫폼팀' }, 'ceo-ui')
    ])
    expect(rs.filter((r) => r.ok)).toHaveLength(1)
    expect((await loadOrg(c.fs)).issues).toEqual([])
  })
})

describe('department IPC handlers', () => {
  async function handlers(open: boolean): Promise<ReturnType<typeof createDomainHandlers>> {
    const c = await makeCompany()
    const state = await mkdtemp(join(tmpdir(), 'mc-dept-state-'))
    dirs.push(c.dir, state)
    const context = new CompanyContext({
      store: { load: async () => null, save: async () => undefined },
      homeDir: '/nonexistent-home'
    })
    if (open) expect((await context.open(c.dir)).ok).toBe(true)
    return createDomainHandlers({
      context,
      providers: new ProviderService(),
      limits: createWeeklyLimitsStore(state)
    })
  }

  it('reports no-company without an open company', async () => {
    const h = await handlers(false)
    for (const r of [
      await h.addDepartment({ name: 'x', leadId: 'pm' }),
      await h.renameDepartment({ from: 'a', to: 'b' }),
      await h.removeDepartment({ name: 'a' })
    ])
      expect(!r.ok && r.code).toBe('no-company')
  })

  it('runs as ceo-ui and rejects a forged actor or non-object input', async () => {
    const h = await handlers(true)
    const r = await h.addDepartment({ name: '콘텐츠팀', leadId: 'pm' })
    expect(r.ok && r.value.record.actor).toBe('ceo-ui')
    for (const bad of [null, 'x', [], { name: 'a', leadId: 'pm', actor: 'approved-proposal' }])
      expect(await h.addDepartment(bad)).toMatchObject({ ok: false, code: 'invalid-request' })
  })
})

describe('org-store hardening carried over from T-064', () => {
  it('rejects chart-breaking characters in titles and departments', async () => {
    const { c, org } = await setup()
    const before = await org()
    await put(c.dir, '.claude/agents/ops.md', '---\nname: ops\n---\n')
    for (const [title, department] of [
      ['운영 (팀)', '개발팀'],
      ['운영', '팀 ── 이름'],
      ['운영', '│팀'],
      ['├운영', '개발팀']
    ])
      expect(
        await addMember(c.fs, { title, agentId: 'ops', department, reportsTo: 'COO', role: 'r' })
      ).toMatchObject({ ok: false, code: 'invalid-request' })
    expect(await org()).toBe(before)
  })

  it('addMember keeps mixed line endings of untouched lines', async () => {
    const { c, org } = await setup()
    const mixed = (await org()).replace('| QA ', '| QA ').split('\n')
    // 표 행 하나만 CRLF로 둔 혼재 문서.
    const idx = mixed.findIndex((l) => l.startsWith('| 개발자'))
    mixed[idx] += '\r'
    await put(c.dir, 'company/org.md', mixed.join('\n'))
    await put(c.dir, '.claude/agents/ops.md', '---\nname: ops\n---\n')
    expect(
      (
        await addMember(c.fs, {
          title: '운영',
          agentId: 'ops',
          department: '개발팀',
          reportsTo: 'CTO',
          role: 'r'
        })
      ).ok
    ).toBe(true)
    const after = await org()
    expect(after.split('\r\n')).toHaveLength(2)
    expect(after.split('\n')).toHaveLength(mixed.length + 1)
  })
})
