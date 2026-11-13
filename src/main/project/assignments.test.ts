import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ApiResult } from '../../shared/result'
import { makeCompany } from '../employee/test-company'
import { buildOrgSnapshot } from '../org/org-snapshot'
import { createAssignmentSource } from './assignments-store'
import { parseProjectDoc, serializeProjectDoc, viewProjectDoc } from './project-doc'
import { PROJECT_FILE } from './project-service'
import { makeProjectTest, projectText, type ProjectTest } from './test-project-company'

const MD = `# 프로젝트 설정

- project_name: 스크립트용 줄은 그대로

## 프로젝트: 앱
- id: app
- 유형: content
- 경로: /abs/app
- 상태: active
- PM: pm
- 직원: developer, ghost

## 프로젝트: 블로그
- id: blog
- 유형: content
- 경로: /abs/blog
- 상태: archived
- 직원: developer

## 프로젝트: 빈
- id: empty
- 유형: content
- 경로: /abs/empty
- 상태: active
`

const tests: ProjectTest[] = []
afterEach(async () => {
  for (const t of tests.splice(0))
    for (const d of t.dirs) await rm(d, { recursive: true, force: true })
})
async function setup(opts: Parameters<typeof makeProjectTest>[0] = {}): Promise<ProjectTest> {
  const t = await makeProjectTest({ projectMd: MD, ...opts })
  tests.push(t)
  return t
}
const ok = <T>(r: ApiResult<T>): T => {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.message}`)
  return r.value
}
const code = (r: ApiResult<unknown>): string => (r.ok ? 'ok' : r.code)

describe('직원: line parsing', () => {
  it('reads members, dedupes, and keeps unrelated lines on rewrite', () => {
    const doc = parseProjectDoc(MD.replace('developer, ghost', 'developer, ghost, developer'))
    expect(viewProjectDoc(doc).items[0].memberIds).toEqual(['developer', 'ghost'])
    expect(serializeProjectDoc(parseProjectDoc(MD))).toBe(MD)
  })
  it('treats a malformed or duplicated 직원 line as an unreadable block', () => {
    for (const bad of ['- 직원: Dev Ops', '- 직원: a,,b'])
      expect(
        viewProjectDoc(parseProjectDoc(MD.replace('- 직원: developer, ghost', bad))).issueLines
      ).toHaveLength(1)
    const dup = MD.replace('- 직원: developer, ghost', '- 직원: pm\n- 직원: cto')
    expect(viewProjectDoc(parseProjectDoc(dup)).issueLines).toHaveLength(1)
  })
})

describe('project:assign-employee', () => {
  it('adds a member, only touching that block, and is idempotent', async () => {
    const t = await setup()
    const first = ok(await t.svc.assignEmployee({ id: 'empty', employeeId: 'ui-dev' }))
    expect(first.record).toMatchObject({
      action: 'assign-employee',
      employeeId: 'ui-dev',
      changedFields: ['members']
    })
    expect(first.project.memberIds).toEqual(['ui-dev'])
    const after = await projectText(t)
    expect(after).toBe(
      MD.replace('- 상태: active\n', '- 상태: active\n').replace(
        /(경로: \/abs\/empty\n- 상태: active)\n$/,
        '$1\n- 직원: ui-dev\n'
      )
    )
    const again = ok(await t.svc.assignEmployee({ id: 'empty', employeeId: 'ui-dev' }))
    expect(again.record.changedFields).toEqual([])
    expect(await projectText(t)).toBe(after)
  })
  it('appends to an existing 직원 line', async () => {
    const t = await setup()
    ok(await t.svc.assignEmployee({ id: 'app', employeeId: 'cto' }))
    expect(await projectText(t)).toContain('- 직원: developer, ghost, cto\n')
  })
  it('rejects unknown, protected, archived, PM and malformed requests without writing', async () => {
    const t = await setup()
    const r = (id: string, employeeId: string, extra = {}): Promise<ApiResult<unknown>> =>
      t.svc.assignEmployee({ id, employeeId, ...extra })
    expect(code(await r('app', 'nobody'))).toBe('not-found')
    expect(code(await r('app', 'coo'))).toBe('forbidden')
    expect(code(await r('app', 'ceo'))).toBe('forbidden')
    expect(code(await r('blog', 'cto'))).toBe('conflict')
    expect(code(await r('app', 'pm'))).toBe('conflict')
    expect(code(await r('nope', 'cto'))).toBe('not-found')
    expect(code(await r('app', '../x'))).toBe('invalid-request')
    expect(code(await r('app', 'cto', { __proto__: 1, extra: 1 }))).toBe('invalid-request')
    expect(code(await t.svc.assignEmployee(null))).toBe('invalid-request')
    expect(await projectText(t)).toBe(MD)
  })
  it('does not leak paths in errors', async () => {
    const t = await setup()
    const r = await t.svc.assignEmployee({ id: 'app', employeeId: 'nobody' })
    expect(JSON.stringify(r)).not.toContain(t.c.dir)
  })
  it('keeps every member when assignments run concurrently', async () => {
    const t = await setup()
    const ids = ['cto', 'cfo', 'hr', 'ui-dev', 'devops']
    const rs = await Promise.all(
      ids.map((employeeId) => t.svc.assignEmployee({ id: 'empty', employeeId }))
    )
    rs.forEach((r) => ok(r))
    const members = viewProjectDoc(parseProjectDoc(await projectText(t))).items.find(
      (p) => p.id === 'empty'
    )?.memberIds
    expect([...(members ?? [])].sort()).toEqual([...ids].sort())
  })
  it('refuses to overwrite when project.md changed between read and write', async () => {
    let dir = ''
    let reads = 0
    const t = await setup({
      wrapFs: (fs) => {
        const w = Object.create(fs) as typeof fs
        w.readText = async (rel: string) => {
          if (rel === PROJECT_FILE && ++reads === 2)
            await writeFile(join(dir, PROJECT_FILE), '# 누군가 고침\n')
          return fs.readText(rel)
        }
        return w
      }
    })
    dir = t.c.dir
    expect(code(await t.svc.assignEmployee({ id: 'empty', employeeId: 'cto' }))).toBe('conflict')
    expect(await projectText(t)).toBe('# 누군가 고침\n')
  })
})

describe('project:unassign-employee', () => {
  it('removes a member (and the line when empty), idempotent, also on archived and unknown ids', async () => {
    const t = await setup()
    ok(await t.svc.unassignEmployee({ id: 'blog', employeeId: 'developer' }))
    expect(await projectText(t)).not.toContain('- 직원: developer\n')
    const again = ok(await t.svc.unassignEmployee({ id: 'blog', employeeId: 'developer' }))
    expect(again.record.changedFields).toEqual([])
    ok(await t.svc.unassignEmployee({ id: 'app', employeeId: 'ghost' }))
    expect(await projectText(t)).toContain('- 직원: developer\n')
  })
  it('refuses to unassign the 담당 PM and reports stateAfter for PM changes', async () => {
    const t = await setup()
    expect(code(await t.svc.unassignEmployee({ id: 'app', employeeId: 'pm' }))).toBe('conflict')
    const cleared = ok(await t.svc.clearPm({ id: 'app' }))
    expect(cleared.stateAfter).toBe('pm-required')
    const set = ok(await t.svc.setPm({ id: 'app', pm: 'pm' }))
    expect(set.stateAfter).toBe('ready')
  })
})

describe('employee:projects', () => {
  it('returns roles, inactive archived projects and warnings', async () => {
    const t = await setup()
    const dev = ok(await t.svc.employeeProjects({ id: 'developer' }))
    expect(dev.projects).toEqual([
      { projectId: 'blog', projectName: '블로그', role: 'member', active: false },
      { projectId: 'app', projectName: '앱', role: 'member', active: true }
    ])
    const pm = ok(await t.svc.employeeProjects({ id: 'pm' }))
    expect(pm.projects).toEqual([{ projectId: 'app', projectName: '앱', role: 'pm', active: true }])
    const ghost = ok(await t.svc.employeeProjects({ id: 'ghost' }))
    expect(ghost.issues).toEqual([
      { code: 'unknown-employee', projectId: 'app', employeeId: 'ghost', role: 'member' }
    ])
    expect(ok(await t.svc.employeeProjects({ id: 'cto' })).projects).toEqual([])
    expect(code(await t.svc.employeeProjects({ id: 'A b' }))).toBe('invalid-request')
  })
  it('restoring an archived project revives its assignments', async () => {
    const t = await setup()
    ok(await t.svc.restore({ id: 'blog' }))
    const dev = ok(await t.svc.employeeProjects({ id: 'developer' }))
    expect(dev.projects.every((p) => p.active)).toBe(true)
  })
})

describe('assignment source and org:get', () => {
  it('lists assignments including archived and PM, so retire is refused', async () => {
    let src: ReturnType<typeof createAssignmentSource> | null = null
    const c = await makeCompany({
      assignments: { listAssignments: (id) => (src as NonNullable<typeof src>).listAssignments(id) }
    })
    src = createAssignmentSource(c.fs)
    try {
      await writeFile(join(c.dir, PROJECT_FILE), MD)
      expect(await src.listAssignments('developer')).toEqual([
        { projectId: 'blog', role: 'member' },
        { projectId: 'app', role: 'member' }
      ])
      expect(await src.listAssignments('cto')).toEqual([])
      const member = await c.service.retire({ id: 'developer', approval: 'D-012' }, 'ceo-ui')
      expect(member.ok ? '' : member.message).toContain('배정을 해제')
      const pm = await c.service.retire({ id: 'pm', approval: 'D-012' }, 'ceo-ui')
      expect(pm.ok ? '' : pm.message).toContain('대체 PM')
    } finally {
      await rm(c.dir, { recursive: true, force: true })
    }
  })
  it('builds agents[].projects and assignmentIssues for org:get', async () => {
    const t = await setup()
    const snap = await buildOrgSnapshot(t.c.fs)
    const byId = new Map(snap.agents.map((a) => [a.id, a]))
    expect(byId.get('pm')?.projects).toEqual([{ id: 'app', name: '앱', role: 'pm', active: true }])
    expect(byId.get('cto')?.projects).toEqual([])
    expect(snap.assignmentIssues).toEqual([
      { code: 'unknown-employee', projectId: 'app', employeeId: 'ghost', role: 'member' }
    ])
  })
  it('still builds the org when project.md is missing', async () => {
    const t = await setup({ projectMd: null })
    const snap = await buildOrgSnapshot(t.c.fs)
    expect(snap.agents.every((a) => a.projects?.length === 0)).toBe(true)
    expect(snap.assignmentIssues).toBeUndefined()
  })
})
