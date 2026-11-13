import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CompanyContext } from '../company/company-context'
import { createCompanyFolder } from '../company/scaffold'
import { createDomainHandlers } from '../domain-ipc'
import { loadOrg } from '../org/org-store'
import { ProviderService } from '../providers/provider-service'
import { FileCompanyRepository } from '../repository/file-repository'
import { SafeFs } from '../repository/safe-fs'
import { createWeeklyLimitsStore } from '../settings/weekly-limits-store'
import { EmployeeService, normalizeTitle } from './employee-service'
import { EMPLOYEE_TEMPLATES } from './templates'
import { parseFirstHire } from './requests'

const made: string[] = []
afterEach(async () => {
  for (const d of made.splice(0)) await rm(d, { recursive: true, force: true })
})

/** 앱이 만든 새 회사 (기본 직원 cto, cfo, hr). */
async function freshCompany(): Promise<{ dir: string; fs: SafeFs; svc: EmployeeService }> {
  const base = await mkdtemp(join(tmpdir(), 'mc-fh-'))
  made.push(base)
  const r = await createCompanyFolder('Co', base)
  if (!r.ok) throw new Error('scaffold failed')
  const fs = await SafeFs.open(r.companyDir)
  const repo = FileCompanyRepository.fromSafeFs(fs)
  const svc = new EmployeeService({
    fs,
    exclusive: (t) => repo.runExclusive(t),
    isApproved: async () => false
  })
  return { dir: r.companyDir, fs, svc }
}

const agentFiles = async (dir: string): Promise<string[]> =>
  (await readdir(join(dir, '.claude/agents'))).sort()
const titles = async (fs: SafeFs): Promise<string[]> =>
  (await loadOrg(fs)).members.map((m) => m.title)

describe('prompt wording is pinned', () => {
  const hr = EMPLOYEE_TEMPLATES.find((t) => t.id === 'hr')
  const pm = EMPLOYEE_TEMPLATES.find((t) => t.id === 'pm')

  it('hr has no Bash and the four write targets', () => {
    expect(hr?.tools).not.toContain('Bash')
    expect(hr?.tools).toEqual(['Read', 'Write', 'Edit', 'Grep', 'Glob'])
    for (const phrase of [
      '인사 관리 권한만 가진다',
      '다음 4가지뿐이다',
      '`.claude/agents/*.md`',
      '`cto`, `cfo`, `hr`은 제외한다',
      '`company/org.md`',
      '`company/archive/`',
      '`직원:`',
      'org.md`의 직원 표와 조직도 블록은 항상 함께 갱신한다',
      '`proposal` 블록',
      '결정 카드를 직접 쓰지 않는다',
      'CEO 승인이 필요한 변경',
      '`Bash` 추가',
      '변경 후 내용의 해시',
      '다른 에이전트를 호출하지 않는다',
      '자격 증명 값을 요구하거나 저장하거나 출력하지 않는다',
      '`PM 필요`',
      '`PM:`'
    ])
      expect(hr?.body, phrase).toContain(phrase)
    // 읽기만 가능한 대상이 빠지지 않았는지.
    for (const ro of [
      '`company/mission.md`',
      '티켓',
      '`company/policies`',
      '`company/finance`',
      '감사 기록'
    ])
      expect(hr?.body, ro).toContain(ro)
  })

  it('keeps PM: and 직원: inside the "4 write targets" section', () => {
    const body = hr?.body ?? ''
    const start = body.indexOf('## 권한 범위')
    const end = body.indexOf('## CEO 승인이 필요한 변경')
    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)
    const section = body.slice(start, end)
    expect(section).toContain('다음 4가지뿐이다')
    expect(section).toContain('`직원:`')
    expect(section).toContain('`PM:`')
  })

  it('pm carries the project management responsibility and limits', () => {
    for (const phrase of [
      '프로젝트 관리를 책임진다',
      '측정 가능한 완료 조건',
      '`policy-change`',
      '인사팀(hr)에 요청',
      '`company/tickets/`',
      '`proposal` 블록',
      '정책, 예산, 회사 설정, 인사',
      '코드를 직접 구현하지 않는다',
      '다른 에이전트를 호출하지 않는다',
      '자격 증명 값을 요구하거나 저장하거나 출력하지 않는다'
    ])
      expect(pm?.body, phrase).toContain(phrase)
    expect(pm?.tools).not.toContain('Bash')
  })
})

describe('missingBaseRoles', () => {
  async function snapshot(dir: string): Promise<string[]> {
    const ctx = new CompanyContext({
      store: { load: async () => null, save: async () => undefined },
      homeDir: '/nonexistent-home'
    })
    expect((await ctx.open(dir)).ok).toBe(true)
    const state = await mkdtemp(join(tmpdir(), 'mc-fh-state-'))
    made.push(state)
    const h = createDomainHandlers({
      context: ctx,
      providers: new ProviderService(),
      limits: createWeeklyLimitsStore(state)
    })
    const r = await h.getOrg()
    if (!r.ok) throw new Error('org failed')
    return r.value.missingBaseRoles
  }

  it('is empty for a new company', async () => {
    const c = await freshCompany()
    expect(await snapshot(c.dir)).toEqual([])
  })

  it('reports hr for an existing company without it and changes nothing', async () => {
    const c = await freshCompany()
    const org = await readFile(join(c.dir, 'company/org.md'), 'utf8')
    const stripped = org
      .split('\n')
      .filter((l) => !l.includes('`hr`'))
      .join('\n')
    await writeFile(join(c.dir, 'company/org.md'), stripped)
    await rm(join(c.dir, '.claude/agents/hr.md'))
    expect(await snapshot(c.dir)).toEqual(['hr'])
    expect(await readFile(join(c.dir, 'company/org.md'), 'utf8')).toBe(stripped)
    expect(await agentFiles(c.dir)).toEqual(['cfo.md', 'cto.md'])
  })

  it('restoring hr works from a click without an approval card, but not other protected hires', async () => {
    const c = await freshCompany()
    const org = await readFile(join(c.dir, 'company/org.md'), 'utf8')
    await writeFile(
      join(c.dir, 'company/org.md'),
      org
        .split('\n')
        .filter((l) => !l.includes('`hr`'))
        .join('\n')
    )
    await rm(join(c.dir, '.claude/agents/hr.md'))
    const restored = await c.svc.create(
      { templateId: 'hr', id: 'hr', department: '인사팀', reportsTo: 'COO' },
      'ceo-ui'
    )
    expect(restored.ok && restored.value.record.sensitiveReasons).toEqual(['protected-role'])
    expect(await titles(c.fs)).toContain('인사')
    // 직급을 바꾼 hr 템플릿 채용은 복구가 아니므로 카드가 필요하다.
    const other = await c.svc.create(
      { templateId: 'hr', id: 'hr-2', title: '인사 보조', department: '인사팀', reportsTo: 'COO' },
      'ceo-ui'
    )
    expect(!other.ok && other.code).toBe('approval-required')
  })
})

describe('hirePm', () => {
  it('hires only the pm and leaves project.md alone', async () => {
    const c = await freshCompany()
    await writeFile(join(c.dir, 'company/project.md'), '- PM: someone\n')
    const r = await c.svc.hirePm('ceo-ui')
    expect(r.ok && r.value.employeeId).toBe('pm')
    expect(await agentFiles(c.dir)).toEqual(['cfo.md', 'cto.md', 'hr.md', 'pm.md'])
    const members = (await loadOrg(c.fs)).members
    expect(members.find((m) => m.title === 'PM')).toMatchObject({
      agentId: 'pm',
      department: '기획팀',
      reportsTo: 'COO'
    })
    expect(await readFile(join(c.dir, 'company/project.md'), 'utf8')).toBe('- PM: someone\n')
  })

  it('rejects a second pm, including one under another file id', async () => {
    const c = await freshCompany()
    expect((await c.svc.hirePm('ceo-ui')).ok).toBe(true)
    const before = await readFile(join(c.dir, 'company/org.md'), 'utf8')
    const again = await c.svc.hirePm('ceo-ui')
    expect(!again.ok && again.code).toBe('conflict')
    expect(!again.ok && again.message).toContain('기존 PM을 선택')
    expect(await readFile(join(c.dir, 'company/org.md'), 'utf8')).toBe(before)

    const d = await freshCompany()
    expect(
      (
        await d.svc.create(
          { templateId: 'pm', id: 'pm-lead', title: 'PM', department: '기획팀', reportsTo: 'COO' },
          'ceo-ui'
        )
      ).ok
    ).toBe(true)
    const dup = await d.svc.hirePm('ceo-ui')
    expect(!dup.ok && dup.code).toBe('conflict')
    expect(await agentFiles(d.dir)).not.toContain('pm.md')
  })

  it('serializes concurrent calls so only one wins', async () => {
    const c = await freshCompany()
    const rs = await Promise.all([c.svc.hirePm('ceo-ui'), c.svc.hirePm('ceo-ui')])
    expect(rs.filter((r) => r.ok)).toHaveLength(1)
  })
})

describe('firstHire', () => {
  it('hires pm then developer; developer reports to CTO', async () => {
    const c = await freshCompany()
    const r = await c.svc.firstHire(undefined, 'ceo-ui')
    expect(r.ok && r.value.records.map((x) => x.employeeId)).toEqual(['pm', 'developer'])
    expect(r.ok && r.value.skipped).toEqual([])
    const org = await loadOrg(c.fs)
    expect(org.issues).toEqual([])
    expect(org.members.find((m) => m.agentId === 'developer')).toMatchObject({
      department: '개발팀',
      reportsTo: 'CTO'
    })
  })

  it('skips existing staff and hires only what is missing', async () => {
    const c = await freshCompany()
    expect((await c.svc.hirePm('ceo-ui')).ok).toBe(true)
    const r = await c.svc.firstHire({}, 'ceo-ui')
    expect(r.ok && r.value.skipped).toEqual(['pm'])
    expect(r.ok && r.value.records.map((x) => x.employeeId)).toEqual(['developer'])
    const none = await c.svc.firstHire({}, 'ceo-ui')
    expect(none.ok && none.value).toEqual({ records: [], skipped: ['pm', 'developer'] })
  })

  it('honors a role subset in fixed order', async () => {
    const c = await freshCompany()
    const r = await c.svc.firstHire({ roles: ['developer'] }, 'ceo-ui')
    expect(r.ok && r.value.records.map((x) => x.employeeId)).toEqual(['developer'])
    expect(await agentFiles(c.dir)).toEqual(['cfo.md', 'cto.md', 'developer.md', 'hr.md'])
  })

  it('rolls back the already hired pm when the developer hire fails', async () => {
    const c = await freshCompany()
    const orgBefore = await readFile(join(c.dir, 'company/org.md'), 'utf8')
    const repo = FileCompanyRepository.fromSafeFs(c.fs)
    let calls = 0
    const failing = new EmployeeService({
      fs: c.fs,
      exclusive: (t) => repo.runExclusive(t),
      isApproved: async () => false,
      orgOps: {
        addMember: async (fs, input) => {
          if (++calls === 2) return { ok: false, code: 'internal', message: 'x' }
          const { addMember } = await import('../org/org-store')
          return addMember(fs, input)
        }
      }
    })
    const r = await failing.firstHire(undefined, 'ceo-ui')
    expect(r.ok).toBe(false)
    expect(calls).toBe(2)
    expect(await agentFiles(c.dir)).toEqual(['cfo.md', 'cto.md', 'hr.md'])
    expect(await readFile(join(c.dir, 'company/org.md'), 'utf8')).toBe(orgBefore)
  })

  it('rejects bad requests without writing', async () => {
    const c = await freshCompany()
    const bad: unknown[] = [
      null,
      [],
      'pm',
      { roles: [] },
      { roles: ['pm', 'pm'] },
      { roles: ['hr'] },
      { roles: 'pm' },
      { roles: ['pm', 'developer', 'developer'] },
      { roles: ['__proto__'] },
      { actor: 'approved-proposal' },
      { roles: Array.from({ length: 1_000_000 }, () => 'pm') }
    ]
    for (const b of bad) {
      const r = await c.svc.firstHire(b, 'ceo-ui')
      expect(!r.ok && r.code, JSON.stringify(b)?.slice(0, 40)).toBe('invalid-request')
    }
    expect(await agentFiles(c.dir)).toEqual(['cfo.md', 'cto.md', 'hr.md'])
  })

  it('rejects an oversized roles array by the length precheck without iterating it', () => {
    const t = Date.now()
    expect(parseFirstHire({ roles: Array.from({ length: 200_000 }, () => 'x'.repeat(5)) }).ok).toBe(
      false
    )
    expect(Date.now() - t).toBeLessThan(500)
  })
})

describe('restore approval needs the ceo-ui actor', () => {
  it('requires an approval card for approved-proposal even for a plain restore', async () => {
    const c = await freshCompany()
    await rm(join(c.dir, '.claude/agents/hr.md'))
    const org = await readFile(join(c.dir, 'company/org.md'), 'utf8')
    await writeFile(
      join(c.dir, 'company/org.md'),
      org
        .split('\n')
        .filter((l) => !l.includes('`hr`'))
        .join('\n')
    )
    const r = await c.svc.create(
      { templateId: 'hr', id: 'hr', department: '인사팀', reportsTo: 'COO' },
      'approved-proposal'
    )
    expect(!r.ok && r.code).toBe('approval-required')
    expect(await agentFiles(c.dir)).toEqual(['cfo.md', 'cto.md'])
  })
})

describe('duplicate PM detection', () => {
  it('normalizes titles', () => {
    for (const t of ['pm', 'Pm', ' PM ', 'PM']) expect(normalizeTitle(t)).toBe('pm')
  })

  it('rejects a PM under a case-variant title', async () => {
    const c = await freshCompany()
    expect(
      (
        await c.svc.create(
          { templateId: 'pm', id: 'lead', title: 'Pm', department: '기획팀', reportsTo: 'COO' },
          'ceo-ui'
        )
      ).ok
    ).toBe(true)
    const r = await c.svc.hirePm('ceo-ui')
    expect(!r.ok && r.code).toBe('conflict')
    expect(!r.ok && r.message).toContain('기존 PM')
    const f = await c.svc.firstHire({ roles: ['pm'] }, 'ceo-ui')
    expect(f.ok && f.value.skipped).toEqual(['pm'])
  })

  it('tells apart the pm id being used by another title', async () => {
    const c = await freshCompany()
    expect(
      (
        await c.svc.create(
          { templateId: 'pm', id: 'pm', title: '기획자', department: '기획팀', reportsTo: 'COO' },
          'ceo-ui'
        )
      ).ok
    ).toBe(true)
    const r = await c.svc.hirePm('ceo-ui')
    expect(!r.ok && r.code).toBe('conflict')
    expect(!r.ok && r.message).toContain('직원 id')
  })
})

describe('firstHire failure handling', () => {
  it('rolls back the new pm but keeps an unrelated developer.md that has no org row', async () => {
    const c = await freshCompany()
    await writeFile(join(c.dir, '.claude/agents/developer.md'), 'keep me\n')
    const orgBefore = await readFile(join(c.dir, 'company/org.md'), 'utf8')
    const r = await c.svc.firstHire(undefined, 'ceo-ui')
    expect(!r.ok && r.code).toBe('conflict')
    expect(await agentFiles(c.dir)).toEqual(['cfo.md', 'cto.md', 'developer.md', 'hr.md'])
    expect(await readFile(join(c.dir, '.claude/agents/developer.md'), 'utf8')).toBe('keep me\n')
    expect(await readFile(join(c.dir, 'company/org.md'), 'utf8')).toBe(orgBefore)
  })

  it('fails on a stray pm.md without a row and changes nothing', async () => {
    const c = await freshCompany()
    await writeFile(join(c.dir, '.claude/agents/pm.md'), 'stray\n')
    const orgBefore = await readFile(join(c.dir, 'company/org.md'), 'utf8')
    const r = await c.svc.firstHire(undefined, 'ceo-ui')
    expect(!r.ok && r.code).toBe('conflict')
    expect(await readFile(join(c.dir, '.claude/agents/pm.md'), 'utf8')).toBe('stray\n')
    expect(await agentFiles(c.dir)).toEqual(['cfo.md', 'cto.md', 'hr.md', 'pm.md'])
    expect(await readFile(join(c.dir, 'company/org.md'), 'utf8')).toBe(orgBefore)
  })

  it('keeps an existing pm when the developer hire then fails', async () => {
    const c = await freshCompany()
    expect((await c.svc.hirePm('ceo-ui')).ok).toBe(true)
    await writeFile(join(c.dir, '.claude/agents/developer.md'), 'keep me\n')
    const r = await c.svc.firstHire(undefined, 'ceo-ui')
    expect(!r.ok && r.code).toBe('conflict')
    expect(await titles(c.fs)).toContain('PM')
    expect(await agentFiles(c.dir)).toContain('pm.md')
  })
})

describe('IPC handlers', () => {
  it('returns fixed errors without a company and never trusts the renderer payload', async () => {
    const ctx = new CompanyContext({
      store: { load: async () => null, save: async () => undefined },
      homeDir: '/nonexistent-home'
    })
    const state = await mkdtemp(join(tmpdir(), 'mc-fh-state-'))
    made.push(state)
    const h = createDomainHandlers({
      context: ctx,
      providers: new ProviderService(),
      limits: createWeeklyLimitsStore(state)
    })
    expect(await h.hirePm()).toMatchObject({ ok: false, code: 'no-company' })
    expect(await h.firstHire(undefined)).toMatchObject({ ok: false, code: 'no-company' })

    const c = await freshCompany()
    expect((await ctx.open(c.dir)).ok).toBe(true)
    const spoof = await h.firstHire({ actor: 'approved-proposal' })
    expect(!spoof.ok && spoof.code).toBe('invalid-request')
    const r = await h.firstHire({ roles: ['pm'] })
    expect(r.ok && r.value.records[0].actor).toBe('ceo-ui')
    const again = await h.hirePm()
    expect(!again.ok && again.code).toBe('conflict')
    expect(JSON.stringify(again)).not.toContain(c.dir)
  })
})
