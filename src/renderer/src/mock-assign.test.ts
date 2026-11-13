import { beforeEach, describe, expect, it } from 'vitest'
import { createMockProjectApi } from './mock-projects'
import { resetMockOrgState } from './mock-org'

const make = (search = ''): ReturnType<typeof createMockProjectApi> =>
  createMockProjectApi('ok', 0, search)

describe('mock project assignment', () => {
  beforeEach(resetMockOrgState)
  it('assigns idempotently and reflects in employee projects', async () => {
    const m = make()
    const first = await m.api.assignProjectEmployee({ id: 'blog', employeeId: 'developer' })
    const again = await m.api.assignProjectEmployee({ id: 'blog', employeeId: 'developer' })
    expect(first.ok && again.ok).toBe(true)
    const list = await m.api.listEmployeeProjects({ id: 'developer' })
    expect(list.ok && list.value.projects.map((p) => p.projectId)).toContain('blog')
    expect(m.entriesFor('developer').filter((e) => e.projectId === 'blog')).toHaveLength(1)
  })
  it('rejects CEO/COO, unknown, archived, PM assign and PM unassign', async () => {
    const m = make()
    expect(await m.api.assignProjectEmployee({ id: 'blog', employeeId: 'coo' })).toMatchObject({
      code: 'forbidden'
    })
    expect(await m.api.assignProjectEmployee({ id: 'blog', employeeId: 'ghost' })).toMatchObject({
      code: 'not-found'
    })
    expect(
      await m.api.assignProjectEmployee({ id: 'old-app', employeeId: 'developer' })
    ).toMatchObject({ code: 'conflict' })
    expect(await m.api.assignProjectEmployee({ id: 'blog', employeeId: 'pm' })).toMatchObject({
      code: 'conflict'
    })
    expect(await m.api.unassignProjectEmployee({ id: 'blog', employeeId: 'pm' })).toMatchObject({
      code: 'conflict'
    })
  })
  it('clear PM reports pm-required in stateAfter', async () => {
    const m = make()
    const r = await m.api.clearProjectPm({ id: 'blog' })
    expect(r.ok && r.value.stateAfter).toBe('pm-required')
  })
  it('keeps archived assignments as inactive and supports failure scenarios', async () => {
    const m = make()
    const cfo = await m.api.listEmployeeProjects({ id: 'cfo' })
    expect(cfo.ok && cfo.value.projects[0]).toMatchObject({ projectId: 'old-app', active: false })
    const bad = make('?mock-assign=conflict')
    expect(await bad.api.assignProjectEmployee({ id: 'blog', employeeId: 'cfo' })).toMatchObject({
      code: 'conflict'
    })
  })
})
