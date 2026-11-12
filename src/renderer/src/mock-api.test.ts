import { beforeEach, describe, expect, it } from 'vitest'
import { mockApi, resetMockApi } from './mock-api'

describe('mockApi', () => {
  beforeEach(() => resetMockApi())

  it('filters tickets by status', async () => {
    const r = await mockApi.listTickets('backlog')
    expect(r.ok && r.value.length > 0 && r.value.every((t) => t.status === 'backlog')).toBe(true)
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
    expect(r.ok && r.value.length > 0 && r.value.every((d) => d.status === 'pending')).toBe(true)
  })

  it('resolves a pending decision once and reflects it in listDecisions', async () => {
    const first = await mockApi.resolveDecision({ id: 'D-001', choice: 'A' })
    expect(first).toMatchObject({ ok: true, value: { status: 'done', chosen: 'A' } })
    const pending = await mockApi.listDecisions('pending')
    expect(pending.ok && pending.value.some((d) => d.id === 'D-001')).toBe(false)
    const done = await mockApi.listDecisions('done')
    expect(done.ok && done.value.some((d) => d.id === 'D-001' && d.chosen === 'A')).toBe(true)
    const again = await mockApi.resolveDecision({ id: 'D-001', choice: 'A' })
    expect(again).toMatchObject({ ok: false, code: 'conflict' })
  })

  it('rejects an unknown choice on a pending decision', async () => {
    const r = await mockApi.resolveDecision({ id: 'D-001', choice: 'Z' })
    expect(r).toMatchObject({ ok: false, code: 'invalid-request' })
  })
})
