import { describe, expect, it } from 'vitest'
import type { OrgSnapshot } from '../../../shared/org'
import type { ProjectInfo } from '../../../shared/project'
import { mockGetOrg } from '../mock-org'
import {
  agentProjects,
  assignErrorText,
  badgeView,
  describeAssignmentIssue,
  employeeCandidates,
  filterOptions,
  highlightTitles,
  isAssigneeUnassigned,
  isUnassigned,
  projectCandidates,
  projectColorIndexes,
  projectPeople,
  projectsByTitle,
  projectsSummary,
  runAssign,
  unassignedEmployees
} from './assign-model'

const proj = (over: Partial<ProjectInfo>): ProjectInfo => ({
  id: 'a',
  name: '앱',
  type: 'development',
  path: '/x',
  devCommand: null,
  defaultBranch: null,
  status: 'active',
  pmId: null,
  pm: null,
  state: 'pm-required',
  git: { status: 'not-repo' },
  ...over
})

describe('agentProjects', () => {
  it('treats a missing field as unassigned and defaults role/active', () => {
    expect(agentProjects(undefined)).toEqual([])
    const list = agentProjects({
      projects: [
        { id: 'b', name: '블로그' },
        { id: 'a', name: '앱', role: 'pm' },
        { id: 'c', name: '구앱', active: false }
      ]
    })
    expect(list.map((p) => p.id)).toEqual(['a', 'c', 'b'])
    expect(list.map((p) => p.name)).toEqual(['앱', '구앱', '블로그'])
    expect(list[2]).toMatchObject({ role: 'member', active: true })
    expect(list[1].active).toBe(false)
  })
  it('summary names role and archived state in text, unassigned when empty', () => {
    expect(projectsSummary([])).toBe('배정 대기')
    expect(
      projectsSummary(
        agentProjects({
          projects: [
            { id: 'a', name: '앱', role: 'pm' },
            { id: 'c', name: '구앱', active: false }
          ]
        })
      )
    ).toBe('앱 (PM), 구앱 (보관됨)')
  })
  it('archived-only assignments still count as unassigned', () => {
    expect(
      isUnassigned(agentProjects({ projects: [{ id: 'c', name: '구', active: false }] }))
    ).toBe(true)
  })
})

describe('badges and filter', () => {
  const list = agentProjects({
    projects: [
      { id: 'p1', name: '가', role: 'pm' },
      { id: 'p2', name: '나' },
      { id: 'p3', name: '다' },
      { id: 'p4', name: '라' },
      { id: 'p5', name: '마', active: false }
    ]
  })
  it('shows at most 3 badges plus +N and flags PM', () => {
    const v = badgeView(list, projectColorIndexes(['p1', 'p2', 'p3', 'p4']))
    expect(v.items.map((i) => i.initial)).toEqual(['가', '나', '다'])
    expect(v.extra).toBe(1)
    expect(v.pm).toBe(true)
  })
  it('color indexes are stable per id regardless of order', () => {
    expect(projectColorIndexes(['b', 'a'])).toEqual(projectColorIndexes(['a', 'b']))
  })
  it('filters highlight members of the project only; null highlights everyone', () => {
    const by = new Map([
      ['A', agentProjects({ projects: [{ id: 'p1', name: '가' }] })],
      ['B', agentProjects({ projects: [{ id: 'p1', name: '가', active: false }] })],
      ['C', []]
    ])
    expect(highlightTitles(by, null)).toBeNull()
    expect([...(highlightTitles(by, 'p1') ?? [])]).toEqual(['A'])
    expect(filterOptions(by)).toEqual([{ id: 'p1', name: '가', count: 1 }])
  })
})

describe('with the mock org', () => {
  const load = async (): Promise<OrgSnapshot> => {
    const r = await mockGetOrg('normal')()
    if (!r.ok) throw new Error('mock')
    return structuredClone(r.value)
  }
  it('lists employees without active projects and excludes CEO/COO', async () => {
    const snap = await load()
    snap.agents = snap.agents.map((a) =>
      a.id === 'developer' ? { ...a, projects: [{ id: 'a', name: '앱' }] } : a
    )
    const ids = unassignedEmployees(snap).map((e) => e.id)
    expect(ids).toContain('cto')
    expect(ids).not.toContain('developer')
    expect(ids).not.toContain('coo')
    expect(projectsByTitle(snap).get('개발자')?.[0].id).toBe('a')
  })
  it('candidates skip existing members and the PM', async () => {
    const snap = await load()
    const ids = projectCandidates(proj({ pmId: 'pm', memberIds: ['cto'] }), snap).map((c) => c.id)
    expect(ids).not.toContain('pm')
    expect(ids).not.toContain('cto')
    expect(ids).toContain('developer')
    expect(ids).not.toContain('devops') // 직원 파일이 없다
  })
  it('people list puts the PM first and marks unknown ids', async () => {
    const snap = await load()
    const rows = projectPeople(proj({ pmId: 'pm', memberIds: ['cto', 'ghost', 'pm'] }), snap)
    expect(rows.map((r) => r.id)).toEqual(['pm', 'cto', 'ghost'])
    expect(rows[0].role).toBe('pm')
    expect(rows[2].known).toBe(false)
  })
})

describe('employeeCandidates', () => {
  it('offers active projects the employee is not on', () => {
    const projects = [
      proj({ id: 'a' }),
      proj({ id: 'b', memberIds: ['x'] }),
      proj({ id: 'c', pmId: 'x' }),
      proj({ id: 'd', status: 'archived' }),
      proj({ id: 'e' })
    ]
    expect(
      employeeCandidates(projects, 'x', [{ id: 'e', name: '', role: 'member', active: true }]).map(
        (p) => p.id
      )
    ).toEqual(['a'])
  })
})

describe('isAssigneeUnassigned', () => {
  it('warns only for assignees outside the project team', () => {
    const p = proj({ pmId: 'pm', memberIds: ['dev'] })
    expect(isAssigneeUnassigned(p, 'pm')).toBe(false)
    expect(isAssigneeUnassigned(p, 'dev')).toBe(false)
    expect(isAssigneeUnassigned(p, 'cfo')).toBe(true)
    expect(isAssigneeUnassigned(p, null)).toBe(false)
    expect(isAssigneeUnassigned(undefined, 'cfo')).toBe(false)
    expect(isAssigneeUnassigned(proj({ status: 'archived' }), 'cfo')).toBe(false)
  })
})

describe('runAssign', () => {
  const names = { project: '앱', employee: '개발자' }
  it('reports success and maps failures to fixed text without leaking messages', async () => {
    const ok = await runAssign(
      {
        assignProjectEmployee: async () => ({
          ok: false,
          code: 'conflict',
          message: '/secret/path'
        }),
        unassignProjectEmployee: async () => {
          throw new Error('/secret/path')
        }
      },
      'assign',
      { id: 'a', employeeId: 'x' },
      names
    )
    expect(ok).toMatchObject({ ok: false, stale: true })
    expect(JSON.stringify(ok)).not.toContain('secret')
    const thrown = await runAssign(
      {
        assignProjectEmployee: async () => ({ ok: false, code: 'internal', message: 'x' }),
        unassignProjectEmployee: async () => {
          throw new Error('/secret/path')
        }
      },
      'unassign',
      { id: 'a', employeeId: 'x' },
      names
    )
    expect(thrown).toMatchObject({ ok: false, stale: false })
    expect(JSON.stringify(thrown)).not.toContain('secret')
  })
  it('error texts distinguish verbs and forbidden', () => {
    expect(assignErrorText('forbidden', '배정')).toContain('CEO')
    expect(assignErrorText('conflict', '해제')).toContain('PM')
  })
  it('describes issues by id only', () => {
    expect(
      describeAssignmentIssue({
        code: 'unknown-employee',
        projectId: 'a',
        employeeId: 'ghost',
        role: 'member'
      })
    ).toContain('ghost')
  })
})
