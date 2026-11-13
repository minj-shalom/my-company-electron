import { beforeEach, describe, expect, it } from 'vitest'
import { createMockHireApi, parseHireScenario } from './mock-hire'
import { mockGetOrg, resetMockOrgState } from './mock-org'

describe('mock hire api', () => {
  beforeEach(() => resetMockOrgState())

  it('parses the scenario with an ok default', () => {
    expect(parseHireScenario('?mock-hire=conflict')).toBe('conflict')
    expect(parseHireScenario('?mock-hire=nope')).toBe('ok')
  })
  it('hires and reflects the default org, skipping on a second call', async () => {
    const { api } = createMockHireApi('ok', 0)
    const org = async (): Promise<number> => {
      const r = await mockGetOrg('default')()
      return r.ok ? r.value.org.members.length : -1
    }
    expect(await org()).toBe(5)
    const first = await api.firstHire({ roles: ['pm', 'developer'] })
    expect(first.ok && first.value.records.map((r) => r.employeeId)).toEqual(['pm', 'developer'])
    expect(await org()).toBe(7)
    const again = await api.firstHire()
    expect(again.ok && again.value.skipped).toEqual(['pm', 'developer'])
  })
  it('rejects a second PM hire as a conflict', async () => {
    const { api } = createMockHireApi('ok', 0)
    expect((await api.hirePm()).ok).toBe(true)
    expect(await api.hirePm()).toMatchObject({ ok: false, code: 'conflict' })
  })
  it('adds hr to the no-hr org', async () => {
    const { api } = createMockHireApi('ok', 0)
    const before = await mockGetOrg('no-hr')()
    expect(before.ok && before.value.missingBaseRoles).toEqual(['hr'])
    const r = await api.createEmployee({
      templateId: 'hr',
      id: 'hr',
      department: '인사팀',
      reportsTo: 'COO'
    })
    expect(r.ok).toBe(true)
    const after = await mockGetOrg('no-hr')()
    expect(after.ok && after.value.missingBaseRoles).toEqual([])
  })
  it.each([
    ['conflict', 'conflict'],
    ['fail', 'internal'],
    ['approval', 'approval-required']
  ] as const)('fails with %s', async (scenario, code) => {
    const { api } = createMockHireApi(scenario, 0)
    expect(await api.firstHire()).toMatchObject({ ok: false, code })
    expect(await api.hirePm()).toMatchObject({ ok: false, code })
    const r = await mockGetOrg('default')()
    expect(r.ok && r.value.org.members.length).toBe(5)
  })
})
