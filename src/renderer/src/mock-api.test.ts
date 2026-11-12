import { describe, expect, it } from 'vitest'
import { mockApi } from './mock-api'

describe('mockApi', () => {
  it('filters tickets by status', async () => {
    const r = await mockApi.listTickets('backlog')
    expect(r.ok && r.value.every((t) => t.status === 'backlog')).toBe(true)
  })

  it('returns not-found for unknown ticket', async () => {
    const r = await mockApi.getTicket('T-999')
    expect(r).toMatchObject({ ok: false, code: 'not-found' })
  })

  it('resolves a pending decision once', async () => {
    const first = await mockApi.resolveDecision({ id: 'D-001', choice: 'A' })
    expect(first).toMatchObject({ ok: true, value: { status: 'done', chosen: 'A' } })
    const again = await mockApi.resolveDecision({ id: 'D-001', choice: 'A' })
    expect(again).toMatchObject({ ok: false, code: 'conflict' })
  })

  it('rejects an unknown choice', async () => {
    const r = await mockApi.resolveDecision({ id: 'D-000', choice: 'Z' })
    expect(r.ok).toBe(false)
  })
})
