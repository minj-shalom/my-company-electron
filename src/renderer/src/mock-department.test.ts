import { beforeEach, describe, expect, it } from 'vitest'
import type { OrgSnapshot } from '../../shared/org'
import type { WindowApi } from '../../shared/api'
import { createMockDepartmentApi } from './mock-department'
import { mockGetOrg, resetMockOrgState } from './mock-org'

const getOrg = async (): Promise<OrgSnapshot | null> => {
  const r = await mockGetOrg('normal')()
  return r.ok ? r.value : null
}
const api = (
  s: Parameters<typeof createMockDepartmentApi>[0] = 'ok'
): Pick<WindowApi, 'addDepartment' | 'renameDepartment' | 'removeDepartment'> =>
  createMockDepartmentApi(s, 0, getOrg)
const names = async (): Promise<string[]> => (await getOrg())!.org.departments.map((d) => d.name)

describe('mock department api', () => {
  beforeEach(() => resetMockOrgState())

  it('add moves the lead into a new room', async () => {
    expect((await api().addDepartment({ name: '콘텐츠팀', leadId: 'pm' })).ok).toBe(true)
    const s = (await getOrg())!
    expect(s.org.departments.find((d) => d.name === '콘텐츠팀')?.members).toEqual(['PM'])
    expect(s.org.departments.map((d) => d.name)).not.toContain('기획팀')
    expect(s.emptyDepartments).toContain('기획팀')
  })

  it('add rejects duplicates, bad names and protected leads', async () => {
    expect(await api().addDepartment({ name: '개발팀', leadId: 'pm' })).toMatchObject({
      code: 'conflict'
    })
    expect(await api().addDepartment({ name: 'a|b', leadId: 'pm' })).toMatchObject({
      code: 'invalid-request'
    })
    expect(await api().addDepartment({ name: '새팀', leadId: 'cto' })).toMatchObject({
      code: 'approval-required'
    })
  })

  it('rename updates members; protected departments are refused', async () => {
    expect((await api().renameDepartment({ from: '개발팀', to: '제품팀' })).ok).toBe(true)
    expect(await names()).toContain('제품팀')
    expect(await api().renameDepartment({ from: '경영', to: '본부' })).toMatchObject({
      code: 'forbidden'
    })
    expect(await api().renameDepartment({ from: 'R&D', to: '연구' })).toMatchObject({
      code: 'approval-required'
    })
  })

  it('remove only works for empty departments', async () => {
    expect(await api().removeDepartment({ name: '개발팀' })).toMatchObject({ code: 'conflict' })
    expect((await api().removeDepartment({ name: '법무팀' })).ok).toBe(true)
    expect((await getOrg())!.emptyDepartments).not.toContain('법무팀')
  })

  it('failure scenarios do not change state', async () => {
    expect(await api('fail').renameDepartment({ from: '개발팀', to: '제품팀' })).toMatchObject({
      code: 'internal'
    })
    expect(await names()).toContain('개발팀')
  })
})
