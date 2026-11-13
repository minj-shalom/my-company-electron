import { describe, expect, it } from 'vitest'
import { createMockGateApi, parseGateScenario } from './mock-gate'

describe('mock gate api', () => {
  it('engages and releases company and project switches', async () => {
    const { api } = createMockGateApi('ok')
    await api.setKillSwitch({ scope: 'company', engaged: true })
    await api.setKillSwitch({ scope: 'project', projectId: 'blog', engaged: true })
    const r = await api.getKillSwitch()
    expect(r.ok && r.value.company && r.value.projects).toEqual(['blog'])
    await api.setKillSwitch({ scope: 'company', engaged: false })
    await api.setKillSwitch({ scope: 'project', projectId: 'blog', engaged: false })
    const after = await api.getKillSwitch()
    expect(after.ok && !after.value.company && after.value.projects.length === 0).toBe(true)
  })
  it('rejects project scope without id', async () => {
    const r = await createMockGateApi('ok').api.setKillSwitch({ scope: 'project', engaged: true })
    expect(r.ok).toBe(false)
  })
  it('scenarios: paused, empty, error', async () => {
    const paused = await createMockGateApi('paused').api.getKillSwitch()
    expect(paused.ok && paused.value.company).toBe(true)
    const empty = await createMockGateApi('empty').api.getAuditSummary({ from: 'a', to: 'b' })
    expect(empty.ok && empty.value.projects).toEqual([])
    const err = await createMockGateApi('error').api.getKillSwitch()
    expect(err.ok).toBe(false)
    expect(parseGateScenario('?mock-gate=paused')).toBe('paused')
    expect(parseGateScenario('?mock-gate=x')).toBe('ok')
  })
})
