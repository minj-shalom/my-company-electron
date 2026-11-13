import { describe, expect, it } from 'vitest'
import { createMockPolicyApi } from './mock-policy'

const projects = async (): Promise<{ id: string; name: string }[]> => [
  { id: 'my-company', name: 'My Company' },
  { id: 'blog', name: '블로그' }
]

describe('mock policy api', () => {
  it('returns conservative defaults when no file exists', async () => {
    const { api } = createMockPolicyApi('ok', 0, projects)
    const r = await api.getPolicy({ projectId: 'blog' })
    expect(r.ok && r.value.exists).toBe(false)
    expect(r.ok && Object.values(r.value.values.modes).every((m) => m === 'every')).toBe(true)
  })
  it('requires confirmAuto, limits and name confirmation, then records history', async () => {
    const { api } = createMockPolicyApi('ok', 0, projects)
    const got = await api.getPolicy({ projectId: 'blog' })
    if (!got.ok) throw new Error('get failed')
    const values = {
      ...got.value.values,
      modes: { ...got.value.values.modes, merge: 'auto' as const }
    }
    const codes = async (v: typeof values, confirm: boolean): Promise<string[]> => {
      const r = await api.savePolicy({
        projectId: 'blog',
        revision: got.value.revision,
        values: v,
        confirmAuto: confirm
      })
      return r.ok && !r.value.saved ? r.value.violations.map((x) => x.code) : []
    }
    expect(await codes(values, false)).toContain('auto-needs-confirm')
    expect(await codes(values, true)).toEqual(
      expect.arrayContaining(['auto-limit-missing', 'auto-target-missing'])
    )
    const prot = {
      ...values,
      dailyLimits: { merge: 3 },
      autoMergeBranches: ['master'],
      confirmInput: '블로그 '
    }
    expect(await codes(prot, true)).toEqual(
      expect.arrayContaining(['protected-merge-unconfirmed', 'protected-limit-exceeded'])
    )
    const ok = { ...prot, dailyLimits: { merge: 2 }, confirmInput: '블로그' }
    const saved = await api.savePolicy({
      projectId: 'blog',
      revision: got.value.revision,
      values: ok,
      confirmAuto: true
    })
    expect(saved.ok && saved.value.saved && saved.value.state.history.at(-1)?.summary).toContain(
      '머지 자동 켬'
    )
    const stale = await api.savePolicy({
      projectId: 'blog',
      revision: got.value.revision,
      values: ok,
      confirmAuto: true
    })
    expect(!stale.ok && stale.code).toBe('conflict')
  })
})
