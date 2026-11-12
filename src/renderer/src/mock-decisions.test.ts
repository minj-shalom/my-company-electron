import { describe, expect, it } from 'vitest'
import { DECISION_KINDS } from '../../shared/decision'
import { createMockDecisionApi, parseDecisionScenario } from './mock-decisions'

describe('mock decisions', () => {
  it('parses the scenario with a safe default', () => {
    expect(parseDecisionScenario('?mock-decisions=many')).toBe('many')
    expect(parseDecisionScenario('?mock-decisions=zzz')).toBe('samples')
    expect(parseDecisionScenario('')).toBe('samples')
  })
  it('covers every kind and includes unreadable samples', async () => {
    const { api } = createMockDecisionApi('samples')
    const r = await api.listDecisions()
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const kinds = new Set(r.value.items.map((d) => d.kind))
    for (const k of DECISION_KINDS) expect(kinds.has(k)).toBe(true)
    expect(r.value.unreadable.length).toBeGreaterThan(0)
  })
  it('supports empty, error and conflict', async () => {
    expect(await createMockDecisionApi('empty').api.listDecisions()).toMatchObject({
      ok: true,
      value: { items: [], unreadable: [] }
    })
    expect(await createMockDecisionApi('error').api.listDecisions()).toMatchObject({ ok: false })
    const c = createMockDecisionApi('conflict').api
    expect(await c.resolveDecision({ id: 'D-001', choice: 'A' })).toMatchObject({
      ok: false,
      code: 'conflict'
    })
  })
})
