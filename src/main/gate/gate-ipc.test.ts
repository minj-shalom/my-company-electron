import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { CompanyContext } from '../company/company-context'
import { createGateHandlers } from './gate-ipc'
import { KillSwitch } from './kill-switch'
import { createJsonStateStore } from './state-store'

const ctx = {} as CompanyContext

describe('gate IPC validation', () => {
  const h = createGateHandlers({ context: ctx, userDataDir: '/unused' })
  it.each([
    null,
    {},
    { scope: 'company' },
    { scope: 'all', engaged: true },
    { scope: 'project', engaged: true },
    { scope: 'project', projectId: '../x', engaged: false },
    { scope: 'company', engaged: 'yes' }
  ])('rejects malformed kill switch request %j', async (req) => {
    expect((await h.setKillSwitch(req)).ok).toBe(false)
  })

  it.each([
    null,
    {},
    { from: 'x', to: 'y' },
    { from: '2026-11-02', to: '2026-11-01' },
    { from: '2020-01-01', to: '2026-01-01' }
  ])('rejects bad audit summary period %j', async (req) => {
    const r = await h.getAuditSummary(req)
    expect(!r.ok && r.code).toBe('invalid-request')
  })

  it('does nothing without a state directory', async () => {
    const r = await createGateHandlers({ context: ctx }).getKillSwitch()
    expect(!r.ok && r.code).toBe('internal')
  })
})

describe('kill switch persistence', () => {
  it('survives restart', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mc-ks-'))
    try {
      const file = join(dir, 'ks.json')
      await new KillSwitch({ store: createJsonStateStore(file) }).set({
        scope: 'project',
        projectId: 'my-company',
        engaged: true
      })
      const again = new KillSwitch({ store: createJsonStateStore(file) })
      expect(await again.isEngaged('my-company')).toBe(true)
      expect(await again.isEngaged('other')).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
