import { describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, (event: unknown, ...a: unknown[]) => unknown>()
vi.mock('electron', () => ({
  ipcMain: {
    handle: (c: string, fn: (event: unknown, ...a: unknown[]) => unknown) => handlers.set(c, fn)
  }
}))

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { IPC_CHANNELS } from '../../shared/api'
import type { CompanyContext } from '../company/company-context'
import { createVisitHandlers, registerVisitHandlers } from './visit-ipc'

const ctx = {
  requireOpenCompany: () => {
    throw new (class NoCompany extends Error {})()
  }
} as unknown as CompanyContext

describe('visit ipc', () => {
  it('rejects untrusted senders on every channel', async () => {
    registerVisitHandlers({ context: ctx, userDataDir: await mkdtemp(join(tmpdir(), 'mc-v-')) })
    for (const c of [
      IPC_CHANNELS.visitSummary,
      IPC_CHANNELS.visitMarkSeen,
      IPC_CHANNELS.visitNotifyGet,
      IPC_CHANNELS.visitNotifySet
    ])
      await expect(
        handlers.get(c)!({ senderFrame: { url: 'https://evil.example/' } }, {})
      ).rejects.toThrow('Untrusted sender')
  })

  it.each([42, 'x', [], { projectId: '../x' }, { projectId: 3 }, { other: 1 }])(
    'rejects bad summary request %j',
    async (req) => {
      const h = createVisitHandlers({ context: ctx, userDataDir: '/unused' })
      const r = await h.getVisitSummary(req)
      expect(!r.ok && r.code).toBe('invalid-request')
    }
  )

  it('validates and persists the notify setting', async () => {
    const h = createVisitHandlers({
      context: ctx,
      userDataDir: await mkdtemp(join(tmpdir(), 'mc-v-'))
    })
    expect(await h.getVisitNotify()).toEqual({ ok: true, value: { enabled: true } })
    for (const bad of [null, {}, { enabled: 'no' }, { enabled: false, x: 1 }])
      expect(await h.setVisitNotify(bad)).toMatchObject({ ok: false, code: 'invalid-request' })
    expect(await h.setVisitNotify({ enabled: false })).toEqual({
      ok: true,
      value: { enabled: false }
    })
    expect(await h.getVisitNotify()).toEqual({ ok: true, value: { enabled: false } })
  })

  it('reports no-company when nothing is open', async () => {
    const h = createVisitHandlers({ context: ctx, userDataDir: '/unused' })
    expect(await h.getVisitSummary(undefined)).toMatchObject({ ok: false })
  })
})
