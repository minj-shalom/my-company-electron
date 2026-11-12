import { beforeEach, describe, expect, it } from 'vitest'
import { mockApi, resetMockApi } from './mock-api'

describe('mockApi', () => {
  beforeEach(() => resetMockApi())

  it('filters tickets by status', async () => {
    const r = await mockApi.listTickets('backlog')
    expect(
      r.ok && r.value.items.length > 0 && r.value.items.every((t) => t.status === 'backlog')
    ).toBe(true)
  })

  it('moves a ticket and restores it on reset', async () => {
    expect(await mockApi.moveTicket({ id: 'T-003', to: 'done' })).toMatchObject({
      ok: true,
      value: { status: 'done' }
    })
    resetMockApi()
    expect(await mockApi.getTicket('T-003')).toMatchObject({ value: { status: 'backlog' } })
  })

  it('returns not-found for unknown ticket', async () => {
    const r = await mockApi.getTicket('T-999')
    expect(r).toMatchObject({ ok: false, code: 'not-found' })
  })

  it('does not leak internal references', async () => {
    const r = await mockApi.getTicket('T-001')
    if (r.ok) r.value.title = 'changed'
    const again = await mockApi.getTicket('T-001')
    expect(again.ok && again.value.title).not.toBe('changed')
  })

  it('filters decisions by status', async () => {
    const r = await mockApi.listDecisions('pending')
    expect(
      r.ok && r.value.items.length > 0 && r.value.items.every((d) => d.status === 'pending')
    ).toBe(true)
  })

  it('resolves a pending decision once and reflects it in listDecisions', async () => {
    const first = await mockApi.resolveDecision({ id: 'D-001', choice: 'A' })
    expect(first).toMatchObject({ ok: true, value: { status: 'done', chosen: 'A' } })
    const pending = await mockApi.listDecisions('pending')
    expect(pending.ok && pending.value.items.some((d) => d.id === 'D-001')).toBe(false)
    const done = await mockApi.listDecisions('done')
    expect(done.ok && done.value.items.some((d) => d.id === 'D-001' && d.chosen === 'A')).toBe(true)
    const again = await mockApi.resolveDecision({ id: 'D-001', choice: 'A' })
    expect(again).toMatchObject({ ok: false, code: 'conflict' })
  })

  it('rejects an unknown choice on a pending decision', async () => {
    const r = await mockApi.resolveDecision({ id: 'D-001', choice: 'Z' })
    expect(r).toMatchObject({ ok: false, code: 'invalid-request' })
  })
})

describe('mockApi onboarding', () => {
  beforeEach(() => resetMockApi())

  it('changes detection results between checks and keeps the last one', async () => {
    const first = await mockApi.detectProviders()
    expect(first.ok && first.value.find((d) => d.provider === 'codex')?.state).toBe('not-installed')
    await mockApi.detectProviders()
    const third = await mockApi.detectProviders()
    expect(third.ok && third.value.every((d) => d.state === 'ok')).toBe(true)
  })

  it('saves, replaces and reads back weekly limits', async () => {
    const saved = await mockApi.saveWeeklyLimits({
      limits: [{ provider: 'claude', amount: 20, unit: 'usd' }]
    })
    expect(saved).toMatchObject({ ok: true })
    const got = await mockApi.getWeeklyLimits()
    expect(got.ok && got.value).toEqual([{ provider: 'claude', amount: 20, unit: 'usd' }])
  })

  it('rejects invalid or duplicate limits', async () => {
    const bad = await mockApi.saveWeeklyLimits({
      limits: [{ provider: 'claude', amount: -1, unit: 'usd' }]
    })
    expect(bad).toMatchObject({ ok: false, code: 'invalid-request' })
    const dup = await mockApi.saveWeeklyLimits({
      limits: [
        { provider: 'claude', amount: 1, unit: 'usd' },
        { provider: 'claude', amount: 2, unit: 'usd' }
      ]
    })
    expect(dup).toMatchObject({ ok: false, code: 'invalid-request' })
  })

  it('only supports the connection test for claude', async () => {
    const c = await mockApi.testProviderConnection('claude')
    expect(c.ok && c.value.state).toBe('ok')
    const g = await mockApi.testProviderConnection('gemini')
    expect(g.ok && g.value.state).toBe('unsupported')
  })
})
