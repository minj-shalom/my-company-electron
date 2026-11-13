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
import { USAGE_SETTINGS_DEFAULT } from '../../shared/usage'
import { NoCompanyError, type CompanyContext } from '../company/company-context'
import { createUsageHandlers, registerUsageHandlers } from './usage-ipc'

const noCompany = {
  requireOpenCompany: () => {
    throw new NoCompanyError()
  }
} as unknown as CompanyContext

describe('usage ipc', () => {
  it('rejects untrusted senders on every channel', async () => {
    const deps = { context: noCompany, userDataDir: await mkdtemp(join(tmpdir(), 'mc-u-')) }
    registerUsageHandlers(deps)
    for (const c of [
      IPC_CHANNELS.usageWidget,
      IPC_CHANNELS.usageSettingsGet,
      IPC_CHANNELS.usageSettingsSave
    ])
      expect(() => handlers.get(c)!({ senderFrame: { url: 'https://evil.example/' } }, {})).toThrow(
        'Untrusted sender'
      )
  })

  it('rejects invalid settings without saving, and saves only known fields', async () => {
    const h = createUsageHandlers({
      context: noCompany,
      userDataDir: await mkdtemp(join(tmpdir(), 'mc-u-'))
    })
    expect(
      await h.saveUsageSettings({ ...USAGE_SETTINGS_DEFAULT, warnPercent: 500 })
    ).toMatchObject({
      ok: false,
      code: 'invalid-request'
    })
    expect(await h.getUsageSettings()).toEqual({ ok: true, value: USAGE_SETTINGS_DEFAULT })
    const saved = await h.saveUsageSettings({
      ...USAGE_SETTINGS_DEFAULT,
      warnPercent: 70,
      extra: 'x'
    })
    expect(saved).toEqual({ ok: true, value: { ...USAGE_SETTINGS_DEFAULT, warnPercent: 70 } })
  })

  it('returns fixed messages without internal paths', async () => {
    const h = createUsageHandlers({ context: noCompany, userDataDir: '/nonexistent' })
    expect(await h.getUsageWidget()).toEqual({
      ok: false,
      code: 'no-company',
      message: '열린 회사가 없습니다.'
    })
    const broken = {
      requireOpenCompany: () => {
        throw new Error('/secret/path ENOENT')
      }
    } as unknown as CompanyContext
    const r = await createUsageHandlers({ context: broken, userDataDir: '/x' }).getUsageWidget()
    expect(JSON.stringify(r)).not.toContain('/secret')
  })
})
