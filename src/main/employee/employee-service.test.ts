import { mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { EmployeeChangeResult } from '../../shared/employee-change'
import type { ApiResult } from '../../shared/result'
import { loadOrg } from '../org/org-store'
import { splitFrontmatter } from '../repository/markdown'
import { EMPLOYEE_TEMPLATES } from './templates'
import {
  agentText,
  makeCompany,
  orgText,
  put,
  snapshotAgents,
  type TestCompany
} from './test-company'

const made: TestCompany[] = []
async function company(extra?: Parameters<typeof makeCompany>[0]): Promise<TestCompany> {
  const c = await makeCompany(extra)
  made.push(c)
  return c
}
afterEach(async () => {
  for (const c of made.splice(0)) await rm(c.dir, { recursive: true, force: true })
})

const okValue = (r: ApiResult<EmployeeChangeResult>): EmployeeChangeResult => {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.message}`)
  return r.value
}
const code = (r: ApiResult<unknown>): string => (r.ok ? 'ok' : r.code)
const hire = { templateId: 'designer', id: 'designer', department: '디자인팀', reportsTo: 'COO' }

async function titles(c: TestCompany): Promise<string[]> {
  return (await loadOrg(c.fs)).members.map((m) => m.title)
}

describe('template library', () => {
  it('has the required templates and valid, unique entries', () => {
    const ids = EMPLOYEE_TEMPLATES.map((t) => t.id)
    for (const id of ['cto', 'cfo', 'hr', 'pm', 'developer', 'reviewer-qa'])
      expect(ids).toContain(id)
    expect(EMPLOYEE_TEMPLATES.length).toBeGreaterThanOrEqual(8)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(EMPLOYEE_TEMPLATES.map((t) => t.title)).size).toBe(ids.length)
  })

  it('pm template carries project management responsibility', () => {
    expect(EMPLOYEE_TEMPLATES.find((t) => t.id === 'pm')?.body).toContain('프로젝트')
  })

  it('every template can be hired through the real validators', async () => {
    const c = await company()
    for (const t of EMPLOYEE_TEMPLATES) {
      const r = await c.service.create(
        {
          templateId: t.id,
          id: `new-${t.id}`,
          title: `신규 ${t.title}`,
          department: t.department,
          reportsTo: 'COO',
          // cto/cfo/hr 템플릿은 민감하므로 승인 카드가 필요하다.
          approval: 'D-012'
        },
        'ceo-ui'
      )
      expect(code(r), t.id).toBe('ok')
    }
    expect((await loadOrg(c.fs)).issues).toEqual([])
  })
})

describe('create', () => {
  it('creates the agent file and the org row together', async () => {
    const c = await company()
    const before = await orgText(c)
    const r = okValue(await c.service.create(hire, 'ceo-ui'))
    expect(r.record).toMatchObject({
      action: 'create',
      employeeId: 'designer',
      actor: 'ceo-ui',
      approval: null,
      sensitive: false,
      files: ['.claude/agents/designer.md', 'company/org.md'],
      at: '2026-11-13T00:00:00.000Z'
    })
    const file = splitFrontmatter(await agentText(c, 'designer'))
    expect(file.data).toEqual({
      name: 'designer',
      description: EMPLOYEE_TEMPLATES.find((t) => t.id === 'designer')?.description,
      tools: 'Read, Write, Edit, Grep, Glob',
      model: 'sonnet'
    })
    const org = await loadOrg(c.fs)
    expect(org.issues).toEqual([])
    expect(org.members.find((m) => m.agentId === 'designer')).toMatchObject({
      title: '디자이너',
      department: '디자인팀',
      reportsTo: 'COO'
    })
    // 기존 줄은 그대로이고 한 줄만 늘었다.
    const after = await orgText(c)
    expect(after.split('\n').length).toBe(before.split('\n').length + 1)
    for (const line of before.split('\n')) expect(after).toContain(line)
    expect((await c.repo.getEmployee('designer')).ok).toBe(true)
  })

  it('honors title and role overrides', async () => {
    const c = await company()
    okValue(
      await c.service.create({ ...hire, title: '수석 디자이너', role: '브랜드 총괄' }, 'ceo-ui')
    )
    const m = (await loadOrg(c.fs)).members.find((x) => x.agentId === 'designer')
    expect(m).toMatchObject({ title: '수석 디자이너', role: '브랜드 총괄' })
  })

  it('rejects an existing name and never overwrites the file', async () => {
    const c = await company()
    const before = await snapshotAgents(c)
    const orgBefore = await orgText(c)
    const r = await c.service.create({ ...hire, id: 'developer', title: '다른 개발자' }, 'ceo-ui')
    expect(code(r)).toBe('conflict')
    expect(await snapshotAgents(c)).toEqual(before)
    expect(await orgText(c)).toBe(orgBefore)
  })

  it('rejects a name whose file exists without an org row (no-clobber)', async () => {
    const c = await company()
    await put(c.dir, '.claude/agents/ghost.md', '---\nname: ghost\ndescription: x\n---\n\nhi\n')
    expect(code(await c.service.create({ ...hire, id: 'ghost' }, 'ceo-ui'))).toBe('conflict')
    expect(await agentText(c, 'ghost')).toContain('hi')
  })

  it('rejects an existing title', async () => {
    const c = await company()
    expect(code(await c.service.create({ ...hire, title: 'QA' }, 'ceo-ui'))).toBe('conflict')
  })

  it('rejects path-escaping and malformed ids', async () => {
    const c = await company()
    const before = await snapshotAgents(c)
    for (const id of [
      '../x',
      '..',
      '/etc/passwd',
      'a\0b',
      'a/b',
      'A',
      '',
      ' x',
      'x'.repeat(51),
      5,
      null
    ]) {
      expect(code(await c.service.create({ ...hire, id }, 'ceo-ui')), String(id)).toBe(
        'invalid-request'
      )
    }
    expect(await snapshotAgents(c)).toEqual(before)
    expect(await readdir(join(c.dir, '.claude'))).toEqual(['agents'])
  })

  it('rejects bad departments, unknown reports-to, unknown templates, extra keys', async () => {
    const c = await company()
    for (const bad of [
      { ...hire, department: 'a|b' },
      { ...hire, department: 'a,b' },
      { ...hire, department: '' },
      { ...hire, reportsTo: '없는 사람' },
      { ...hire, templateId: 'nope' },
      { ...hire, templateId: '__proto__' },
      { ...hire, actor: 'approved-proposal' },
      { ...hire, role: 'a\nb' },
      { ...hire, approval: 'D-1; rm' },
      'string',
      null,
      [hire]
    ])
      expect(code(await c.service.create(bad, 'ceo-ui'))).toBe('invalid-request')
    expect(await titles(c)).not.toContain('디자이너')
  })

  it('rejects an invalid actor', async () => {
    const c = await company()
    expect(code(await c.service.create(hire, 'root' as never))).toBe('invalid-request')
  })

  it('rolls back the file when the org row cannot be added', async () => {
    for (const mode of ['fail', 'throw'] as const) {
      const c = await company({
        orgOps: {
          addMember: async () => {
            if (mode === 'throw') throw new Error('disk exploded at /secret/path')
            return { ok: false, code: 'internal', message: 'org.md를 갱신하지 못했습니다.' }
          }
        }
      })
      const orgBefore = await orgText(c)
      const r = await c.service.create(hire, 'ceo-ui')
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.message).not.toContain('/secret')
      expect(await readdir(join(c.dir, '.claude/agents'))).not.toContain('designer.md')
      expect(await orgText(c)).toBe(orgBefore)
    }
  })

  it('keeps a file someone else changed during rollback', async () => {
    const c = await company({
      orgOps: {
        addMember: async () => {
          await writeFile(join(c0.dir, '.claude/agents/designer.md'), 'edited by someone\n')
          return { ok: false, code: 'internal', message: 'x' }
        }
      }
    })
    const c0 = c
    await c.service.create(hire, 'ceo-ui')
    expect(await agentText(c, 'designer')).toBe('edited by someone\n')
  })

  it('creates two different hires concurrently without losing a row', async () => {
    const c = await company()
    const [a, b] = await Promise.all([
      c.service.create(hire, 'ceo-ui'),
      c.service.create(
        { ...hire, templateId: 'researcher', id: 'researcher', department: '리서치팀' },
        'ceo-ui'
      )
    ])
    expect([a.ok, b.ok]).toEqual([true, true])
    expect(await titles(c)).toEqual(expect.arrayContaining(['디자이너', '리서처']))
    expect((await loadOrg(c.fs)).issues).toEqual([])
  })

  it('lets only one of two same-name hires win', async () => {
    const c = await company()
    const rs = await Promise.all([
      c.service.create(hire, 'ceo-ui'),
      c.service.create(hire, 'ceo-ui')
    ])
    expect(rs.map(code).sort()).toEqual(['conflict', 'ok'])
  })
})

describe('approval gate', () => {
  const cto2 = {
    templateId: 'cto',
    id: 'cto-2',
    title: '기술 고문',
    department: 'R&D',
    reportsTo: 'COO'
  }

  it('requires an approval card for sensitive hires and writes nothing without it', async () => {
    const c = await company()
    const before = await snapshotAgents(c)
    const orgBefore = await orgText(c)
    expect(code(await c.service.create(cto2, 'ceo-ui'))).toBe('approval-required')
    expect(code(await c.service.create({ ...cto2, approval: 'D-016' }, 'ceo-ui'))).toBe(
      'approval-required'
    ) // pending 카드
    expect(code(await c.service.create({ ...cto2, approval: 'D-999' }, 'ceo-ui'))).toBe(
      'approval-required'
    ) // 없는 카드
    expect(await snapshotAgents(c)).toEqual(before)
    expect(await orgText(c)).toBe(orgBefore)
    const r = okValue(await c.service.create({ ...cto2, approval: 'D-012' }, 'approved-proposal'))
    expect(r.record).toMatchObject({
      sensitive: true,
      sensitiveReasons: ['protected-role'],
      approval: 'D-012',
      actor: 'approved-proposal'
    })
  })

  it.each(['cto', 'cfo', 'hr'])('update of %s needs approval', async (id) => {
    const c = await company()
    const before = await agentText(c, id)
    expect(code(await c.service.update({ id, model: 'opus' }, 'ceo-ui'))).toBe('approval-required')
    expect(await agentText(c, id)).toBe(before)
    okValue(await c.service.update({ id, model: 'opus', approval: 'D-012' }, 'approved-proposal'))
    expect(splitFrontmatter(await agentText(c, id)).data.model).toBe('opus')
  })

  it.each(['cto', 'cfo', 'hr'])('move of %s needs approval', async (id) => {
    const c = await company()
    const orgBefore = await orgText(c)
    expect(code(await c.service.move({ id, department: '경영' }, 'ceo-ui'))).toBe(
      'approval-required'
    )
    expect(await orgText(c)).toBe(orgBefore)
    okValue(await c.service.move({ id, department: '경영', approval: 'D-012' }, 'ceo-ui'))
  })
})

describe('update', () => {
  it('changes description, model, tools and body while keeping other keys', async () => {
    const c = await company()
    await put(
      c.dir,
      '.claude/agents/pm.md',
      '---\nname: pm\ndescription: old\ntools: Read, Grep\nmodel: sonnet\ncolor: blue\n---\n\n# PM\n\n본문 유지\n'
    )
    const r = okValue(
      await c.service.update(
        {
          id: 'pm',
          description: '새 설명',
          model: 'opus',
          tools: ['Read', 'Glob'],
          body: '# PM\n\n새 본문'
        },
        'ceo-ui'
      )
    )
    expect(r.record.changedFields).toEqual(['description', 'model', 'tools', 'body'])
    expect(r.record.sensitive).toBe(false)
    const f = splitFrontmatter(await agentText(c, 'pm'))
    expect(f.data).toEqual({
      name: 'pm',
      description: '새 설명',
      tools: 'Read, Glob',
      model: 'opus',
      color: 'blue'
    })
    expect(f.body).toBe('\n# PM\n\n새 본문\n')
  })

  it('keeps the body untouched when only the description changes', async () => {
    const c = await company()
    const old = splitFrontmatter(await agentText(c, 'pm'))
    okValue(await c.service.update({ id: 'pm', description: '바뀐 설명' }, 'ceo-ui'))
    const now = splitFrontmatter(await agentText(c, 'pm'))
    expect(now.body).toBe(old.body.startsWith('\n') ? old.body : `\n${old.body}`)
    expect(now.data.description).toBe('바뀐 설명')
    expect(now.data.tools).toBe(old.data.tools)
  })

  it('is a no-op when nothing changes', async () => {
    const c = await company()
    const before = await agentText(c, 'pm')
    const r = okValue(await c.service.update({ id: 'pm', model: 'sonnet' }, 'ceo-ui'))
    expect(r.record.changedFields).toEqual([])
    expect(r.record.files).toEqual([])
    expect(await agentText(c, 'pm')).toBe(before)
  })

  it('validates model, tools, description and body', async () => {
    const c = await company()
    const before = await snapshotAgents(c)
    const bad: unknown[] = [
      { id: 'pm' },
      { id: 'pm', model: 'gpt-9' },
      { id: 'pm', model: ['sonnet'] },
      { id: 'pm', tools: 'Read' },
      { id: 'pm', tools: ['Read; rm -rf'] },
      { id: 'pm', tools: ['Read', 'Read'] },
      { id: 'pm', tools: ['Bash()'] },
      { id: 'pm', tools: ['Read,Write'] },
      { id: 'pm', tools: [''] },
      { id: 'pm', tools: Array.from({ length: 31 }, (_, i) => `T${i}`) },
      { id: 'pm', description: '' },
      { id: 'pm', description: 'x'.repeat(1001) },
      { id: 'pm', description: 5 },
      { id: 'pm', body: '   \n ' },
      { id: 'pm', body: 'a'.repeat(1_000_001) },
      { id: 'pm', body: 'x\0y' },
      { id: 'pm', description: 'ok', actor: 'ceo-ui' },
      { id: '../pm', description: 'ok' }
    ]
    for (const b of bad)
      expect(code(await c.service.update(b, 'ceo-ui')), JSON.stringify(b).slice(0, 60)).toBe(
        'invalid-request'
      )
    expect(await snapshotAgents(c)).toEqual(before)
  })

  it('accepts a body at the 1MB cap and the file stays readable', async () => {
    const c = await company()
    okValue(await c.service.update({ id: 'pm', body: 'a'.repeat(1_000_000) }, 'ceo-ui'))
    expect((await c.repo.getEmployee('pm')).ok).toBe(true)
  })

  it('requires approval for tools expansion', async () => {
    const c = await company()
    const before = await agentText(c, 'reviewer-qa')
    for (const tools of [
      ['Read', 'Bash'],
      ['Read', 'Write'],
      ['Read', 'Bash(git:*)'],
      ['mcp__x__y'],
      []
    ]) {
      expect(
        code(await c.service.update({ id: 'reviewer-qa', tools }, 'ceo-ui')),
        tools.join()
      ).toBe('approval-required')
    }
    expect(await agentText(c, 'reviewer-qa')).toBe(before)
    // 읽기 전용 도구 추가와 축소는 승인이 필요 없다.
    okValue(await c.service.update({ id: 'reviewer-qa', tools: ['Read', 'WebFetch'] }, 'ceo-ui'))
    okValue(await c.service.update({ id: 'reviewer-qa', tools: ['Read'] }, 'ceo-ui'))
    const r = okValue(
      await c.service.update(
        { id: 'reviewer-qa', tools: ['Read', 'Bash'], approval: 'D-012' },
        'ceo-ui'
      )
    )
    expect(r.record.sensitiveReasons).toEqual(['tools-expansion'])
  })

  it('refuses to overwrite broken frontmatter', async () => {
    const c = await company()
    for (const broken of [
      '---\nname: pm\ndescription: [unclosed\n---\n\nbody\n',
      '---\n- just\n- a list\n---\n\nbody\n',
      '# no frontmatter at all\n',
      '---\nname: pm\n---\n\nno description\n'
    ]) {
      await put(c.dir, '.claude/agents/pm.md', broken)
      expect(code(await c.service.update({ id: 'pm', description: '새 설명' }, 'ceo-ui'))).toBe(
        'invalid-request'
      )
      expect(await agentText(c, 'pm')).toBe(broken)
    }
  })

  it('rejects unknown employees and protected rows', async () => {
    const c = await company()
    expect(code(await c.service.update({ id: 'ghost', description: 'x' }, 'ceo-ui'))).toBe(
      'not-found'
    )
    expect(code(await c.service.update({ id: 'claude', description: 'x' }, 'ceo-ui'))).toBe(
      'not-found'
    )
    // COO를 에이전트 파일 행으로 바꿔 둔 회사: 보호 직원은 수정·이동·퇴사 모두 거부.
    const org = (await orgText(c)).replace('`CLAUDE.md` (메인 세션)', '`coo`')
    await put(c.dir, 'company/org.md', org)
    await put(c.dir, '.claude/agents/coo.md', '---\nname: coo\ndescription: coo\n---\n\nx\n')
    for (const r of [
      await c.service.update({ id: 'coo', description: 'y', approval: 'D-012' }, 'ceo-ui'),
      await c.service.move({ id: 'coo', department: '개발팀', approval: 'D-012' }, 'ceo-ui'),
      await c.service.retire({ id: 'coo', approval: 'D-012' }, 'ceo-ui')
    ])
      expect(code(r)).toBe('forbidden')
    expect(await agentText(c, 'coo')).toContain('description: coo')
  })

  it('refuses a symlinked agent file and leaves the target alone', async () => {
    const c = await company()
    await rm(join(c.dir, '.claude/agents/pm.md'))
    await mkdir(join(c.dir, 'outside'))
    await writeFile(join(c.dir, 'outside/secret.md'), 'secret\n')
    await symlink(join(c.dir, 'outside/secret.md'), join(c.dir, '.claude/agents/pm.md'))
    const r = await c.service.update({ id: 'pm', description: 'x' }, 'ceo-ui')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).not.toContain(c.dir)
    expect(await readFile(join(c.dir, 'outside/secret.md'), 'utf8')).toBe('secret\n')
  })
})

describe('move', () => {
  it('changes department and reports-to in org.md only', async () => {
    const c = await company()
    const agents = await snapshotAgents(c)
    const r = okValue(
      await c.service.move({ id: 'developer', department: '플랫폼팀', reportsTo: 'PM' }, 'ceo-ui')
    )
    expect(r.record.changedFields).toEqual(['department', 'reportsTo'])
    expect(r.record.files).toEqual(['company/org.md'])
    expect(await snapshotAgents(c)).toEqual(agents)
    const m = (await loadOrg(c.fs)).members.find((x) => x.agentId === 'developer')
    expect(m).toMatchObject({ department: '플랫폼팀', reportsTo: 'PM' })
    expect((await loadOrg(c.fs)).issues).toEqual([])
  })

  it('rejects cycles, self reports and unknown targets', async () => {
    const c = await company()
    const orgBefore = await orgText(c)
    // developer -> CTO -> COO. CTO가 developer에게 보고하면 순환.
    expect(
      code(await c.service.move({ id: 'cto', reportsTo: '개발자', approval: 'D-012' }, 'ceo-ui'))
    ).toBe('invalid-request')
    expect(code(await c.service.move({ id: 'developer', reportsTo: '개발자' }, 'ceo-ui'))).toBe(
      'invalid-request'
    )
    expect(code(await c.service.move({ id: 'developer', reportsTo: '없는 직급' }, 'ceo-ui'))).toBe(
      'invalid-request'
    )
    // 두 단계 순환: QA -> 개발자 후 개발자 -> QA
    okValue(await c.service.move({ id: 'reviewer-qa', reportsTo: '개발자' }, 'ceo-ui'))
    const mid = await orgText(c)
    expect(code(await c.service.move({ id: 'developer', reportsTo: 'QA' }, 'ceo-ui'))).toBe(
      'invalid-request'
    )
    expect(await orgText(c)).toBe(mid)
    expect(orgBefore).not.toBe(mid)
  })

  it('is a no-op when nothing changes', async () => {
    const c = await company()
    const before = await orgText(c)
    const r = okValue(await c.service.move({ id: 'developer', department: '개발팀' }, 'ceo-ui'))
    expect(r.record.changedFields).toEqual([])
    expect(await orgText(c)).toBe(before)
  })

  it('warns when the PM title changes and rejects titles in use', async () => {
    const c = await company()
    const r = okValue(await c.service.move({ id: 'pm', title: '기획자' }, 'ceo-ui'))
    expect(r.warnings.map((w) => w.code)).toEqual(['pm-required'])
    expect(code(await c.service.move({ id: 'developer', title: 'QA' }, 'ceo-ui'))).toBe('conflict')
    // CTO를 보고 대상으로 쓰는 직원이 있어 직급을 못 바꾼다.
    expect(
      code(await c.service.move({ id: 'cto', title: '기술이사', approval: 'D-012' }, 'ceo-ui'))
    ).toBe('conflict')
  })

  it('preserves line endings of untouched lines', async () => {
    const c = await company()
    const crlf = (await orgText(c)).replace(/\n/g, '\r\n')
    await put(c.dir, 'company/org.md', crlf)
    okValue(await c.service.move({ id: 'developer', department: '플랫폼팀' }, 'ceo-ui'))
    const after = await orgText(c)
    expect(after.replace(/\r\n/g, '')).not.toContain('\n')
    expect(after.split('\r\n').length).toBe(crlf.split('\r\n').length)
  })
})

describe('retire', () => {
  it('moves the file to the archive and removes the row (needs approval)', async () => {
    const c = await company()
    const orig = await agentText(c, 'developer')
    const orgBefore = await orgText(c)
    expect(code(await c.service.retire({ id: 'developer' }, 'ceo-ui'))).toBe('approval-required')
    expect(await agentText(c, 'developer')).toBe(orig)

    const r = okValue(await c.service.retire({ id: 'developer', approval: 'D-012' }, 'ceo-ui'))
    expect(r.record).toMatchObject({
      action: 'retire',
      sensitive: true,
      sensitiveReasons: ['retire']
    })
    expect(r.record.files).toContain('company/archive/employees/developer.md')
    expect(await readFile(join(c.dir, 'company/archive/employees/developer.md'), 'utf8')).toBe(orig)
    expect(await readdir(join(c.dir, '.claude/agents'))).not.toContain('developer.md')
    const after = await orgText(c)
    expect(after).not.toContain('`developer`')
    expect(after.split('\n').length).toBe(orgBefore.split('\n').length - 1)
    expect((await loadOrg(c.fs)).issues).toEqual([])
  })

  it('numbers archive names instead of overwriting', async () => {
    const c = await company()
    await put(c.dir, 'company/archive/employees/developer.md', 'older\n')
    await put(c.dir, 'company/archive/employees/developer-2.md', 'older 2\n')
    const r = okValue(await c.service.retire({ id: 'developer', approval: 'D-012' }, 'ceo-ui'))
    expect(r.record.files).toContain('company/archive/employees/developer-3.md')
    expect(await readFile(join(c.dir, 'company/archive/employees/developer.md'), 'utf8')).toBe(
      'older\n'
    )
    expect(await readFile(join(c.dir, 'company/archive/employees/developer-2.md'), 'utf8')).toBe(
      'older 2\n'
    )
  })

  it('rejects someone others report to and department leads, before asking for approval', async () => {
    const c = await company()
    const before = await snapshotAgents(c)
    const org = await orgText(c)
    expect(code(await c.service.retire({ id: 'cto' }, 'ceo-ui'))).toBe('conflict')
    expect(code(await c.service.retire({ id: 'cto', approval: 'D-012' }, 'ceo-ui'))).toBe(
      'conflict'
    )
    // 같은 부서 직원이 보고하는 부서장.
    await c.service.move({ id: 'ui-dev', reportsTo: '개발자' }, 'ceo-ui')
    const r = await c.service.retire({ id: 'developer', approval: 'D-012' }, 'ceo-ui')
    expect(r.ok ? '' : r.message).toContain('부서장')
    expect(await snapshotAgents(c)).toEqual(before)
    expect(await orgText(c)).not.toBe(org)
    await expect(readdir(join(c.dir, 'company/archive'))).rejects.toThrow()
  })

  it('rejects employees with project assignments or as PM', async () => {
    const c = await company({
      assignments: {
        listAssignments: async (id) =>
          id === 'developer'
            ? [{ projectId: 'p1', role: 'member' }]
            : id === 'pm'
              ? [{ projectId: 'p1', role: 'pm' }]
              : []
      }
    })
    const before = await snapshotAgents(c)
    const a = await c.service.retire({ id: 'developer', approval: 'D-012' }, 'ceo-ui')
    expect(a.ok ? '' : a.message).toContain('배정을 해제')
    const b = await c.service.retire({ id: 'pm', approval: 'D-012' }, 'ceo-ui')
    expect(b.ok ? '' : b.message).toContain('대체 PM')
    expect(await snapshotAgents(c)).toEqual(before)
  })

  it('fails closed when the assignment lookup throws', async () => {
    const c = await company({
      assignments: {
        listAssignments: async () => {
          throw new Error('boom')
        }
      }
    })
    expect(code(await c.service.retire({ id: 'developer', approval: 'D-012' }, 'ceo-ui'))).toBe(
      'internal'
    )
    expect(await readdir(join(c.dir, '.claude/agents'))).toContain('developer.md')
  })

  it('restores the file and removes the archive copy when the row cannot be removed', async () => {
    for (const mode of ['fail', 'throw'] as const) {
      const c = await company({
        orgOps: {
          removeMember: async () => {
            if (mode === 'throw') throw new Error('disk exploded')
            return { ok: false, code: 'internal', message: 'org.md를 갱신하지 못했습니다.' }
          }
        }
      })
      const agents = await snapshotAgents(c)
      const org = await orgText(c)
      const r = await c.service.retire({ id: 'developer', approval: 'D-012' }, 'ceo-ui')
      expect(r.ok).toBe(false)
      expect(await snapshotAgents(c)).toEqual(agents)
      expect(await orgText(c)).toBe(org)
      expect(await readdir(join(c.dir, 'company/archive/employees'))).toEqual([])
    }
  })

  it('removes only the row when the agent file is already gone', async () => {
    const c = await company()
    await rm(join(c.dir, '.claude/agents/developer.md'))
    const r = okValue(await c.service.retire({ id: 'developer', approval: 'D-012' }, 'ceo-ui'))
    expect(r.record.files).toEqual(['company/org.md'])
    expect(await titles(c)).not.toContain('개발자')
  })

  it('serializes with other writes on the same queue', async () => {
    const c = await company()
    const [a, b] = await Promise.all([
      c.service.retire({ id: 'developer', approval: 'D-012' }, 'ceo-ui'),
      c.service.update({ id: 'developer', description: '새 설명' }, 'ceo-ui')
    ])
    // 먼저 들어온 퇴사가 끝난 뒤 수정이 돌아 not-found가 된다 (직원 파일이 반쯤 남지 않는다).
    expect(a.ok).toBe(true)
    expect(code(b)).toBe('not-found')
  })
})

describe('review follow-ups', () => {
  it('treats a protected target title as sensitive and COO/CEO titles as forbidden', async () => {
    const c = await company()
    // pm -> 직급을 비어 있는 보호 직급으로: 먼저 CFO 행을 퇴사시켜 자리를 만든다 (승인 카드 사용).
    okValue(await c.service.retire({ id: 'cfo', approval: 'D-012' }, 'ceo-ui'))
    const before = await orgText(c)
    expect(code(await c.service.move({ id: 'pm', title: 'CFO' }, 'ceo-ui'))).toBe(
      'approval-required'
    )
    expect(await orgText(c)).toBe(before)
    const r = okValue(await c.service.move({ id: 'pm', title: 'CFO', approval: 'D-012' }, 'ceo-ui'))
    expect(r.record.sensitiveReasons).toEqual(['protected-role'])
    for (const title of ['COO', 'CEO']) {
      expect(
        code(await c.service.move({ id: 'developer', title, approval: 'D-012' }, 'ceo-ui'))
      ).toBe('forbidden')
    }
  })

  it('rejects approval cards that are done but have no recorded choice', async () => {
    const c = await company()
    const before = await agentText(c, 'cto')
    expect(
      code(await c.service.update({ id: 'cto', model: 'opus', approval: 'D-001' }, 'ceo-ui'))
    ).toBe('approval-required')
    expect(await agentText(c, 'cto')).toBe(before)
  })

  it('compares tools case-insensitively and counts Task/Agent/Skill and changed Bash args', async () => {
    const c = await company()
    await put(
      c.dir,
      '.claude/agents/pm.md',
      '---\nname: pm\ndescription: d\ntools: Read, Bash(git:*)\n---\n\nb\n'
    )
    for (const tools of [
      ['Read', 'bash'],
      ['Read', 'BASH(rm:*)'],
      ['Read', 'Bash(git:*)', 'Bash(rm:*)'],
      ['Read', 'task'],
      ['Read', 'Agent'],
      ['Read', 'skill'],
      ['Read', 'WRITE']
    ])
      expect(code(await c.service.update({ id: 'pm', tools }, 'ceo-ui')), tools.join()).toBe(
        'approval-required'
      )
    // 같은 도구를 대소문자만 바꿔 다시 적는 것은 확대가 아니다.
    okValue(await c.service.update({ id: 'pm', tools: ['read', 'bash(git:*)'] }, 'ceo-ui'))
  })

  it('fails retire when company/archive is a symlink', async () => {
    const c = await company()
    await mkdir(join(c.dir, 'elsewhere'))
    await mkdir(join(c.dir, 'company/archive'), { recursive: true })
    await symlink(join(c.dir, 'elsewhere'), join(c.dir, 'company/archive/employees'))
    const before = await snapshotAgents(c)
    const orgBefore = await orgText(c)
    expect(code(await c.service.retire({ id: 'developer', approval: 'D-012' }, 'ceo-ui'))).toBe(
      'internal'
    )
    expect(await snapshotAgents(c)).toEqual(before)
    expect(await orgText(c)).toBe(orgBefore)
    expect(await readdir(join(c.dir, 'elsewhere'))).toEqual([])
  })

  it('fails retire when all 99 archive names are taken', async () => {
    const c = await company()
    await put(c.dir, 'company/archive/employees/developer.md', 'x\n')
    for (let n = 2; n <= 99; n++)
      await put(c.dir, `company/archive/employees/developer-${n}.md`, 'x\n')
    const before = await snapshotAgents(c)
    expect(code(await c.service.retire({ id: 'developer', approval: 'D-012' }, 'ceo-ui'))).toBe(
      'internal'
    )
    expect(await snapshotAgents(c)).toEqual(before)
    expect((await loadOrg(c.fs)).members.map((m) => m.agentId)).toContain('developer')
  })
})
