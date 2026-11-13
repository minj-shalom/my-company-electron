import { beforeEach, describe, expect, it } from 'vitest'
import { createMockEmployeeApi } from './mock-employee'
import { MOCK_TEMPLATES, createMockHireApi } from './mock-hire'
import { mockGetOrg, resetMockOrgState } from './mock-org'

const make = (
  s: Parameters<typeof createMockEmployeeApi>[0]
): ReturnType<typeof createMockEmployeeApi>['api'] =>
  createMockEmployeeApi(s, 0, createMockHireApi('ok', 0).api.createEmployee, MOCK_TEMPLATES).api

describe('mock employee api', () => {
  beforeEach(resetMockOrgState)
  it('hires, moves, edits and retires, reflected in getOrg', async () => {
    const api = make('ok')
    await api.createEmployee({
      templateId: 'developer',
      id: 'dev-2',
      title: '개발자 2',
      department: '개발팀',
      reportsTo: 'CTO'
    })
    let org = await mockGetOrg('normal')()
    expect(org.ok && org.value.org.members.some((m) => m.agentId === 'dev-2')).toBe(true)
    await api.moveEmployee({ id: 'dev-2', department: '기획팀' })
    await api.updateEmployee({ id: 'dev-2', description: '바뀜' })
    org = await mockGetOrg('normal')()
    expect(org.ok && org.value.org.members.find((m) => m.agentId === 'dev-2')?.department).toBe(
      '기획팀'
    )
    expect(org.ok && org.value.agents.find((a) => a.id === 'dev-2')?.description).toBe('바뀜')
    await api.retireEmployee({ id: 'dev-2' })
    org = await mockGetOrg('normal')()
    expect(org.ok && org.value.org.members.some((m) => m.agentId === 'dev-2')).toBe(false)
  })
  it.each([
    ['conflict', 'conflict'],
    ['forbidden', 'forbidden'],
    ['approval', 'approval-required'],
    ['fail', 'internal']
  ] as const)('scenario %s fails with %s', async (s, code) => {
    expect(await make(s).retireEmployee({ id: 'qa' })).toMatchObject({ ok: false, code })
  })
  it('cycle scenario rejects only moves', async () => {
    const api = make('cycle')
    expect(await api.moveEmployee({ id: 'x', reportsTo: 'CTO' })).toMatchObject({
      code: 'invalid-request'
    })
    expect((await api.retireEmployee({ id: 'x' })).ok).toBe(true)
  })
})
