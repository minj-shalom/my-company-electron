import { describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, (event: unknown, ...a: unknown[]) => unknown>()
vi.mock('electron', () => ({
  ipcMain: {
    handle: (c: string, fn: (event: unknown, ...a: unknown[]) => unknown) => handlers.set(c, fn)
  }
}))

import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { IPC_CHANNELS } from '../../shared/api'
import { createThemeHandlers, registerThemeHandlers } from './theme-ipc'

describe('theme ipc', () => {
  it('rejects untrusted senders', async () => {
    registerThemeHandlers(await mkdtemp(join(tmpdir(), 'mc-t-')))
    for (const c of [IPC_CHANNELS.settingsThemeGet, IPC_CHANNELS.settingsThemeSave])
      expect(() =>
        handlers.get(c)!({ senderFrame: { url: 'https://evil.example/' } }, 'dark')
      ).toThrow('Untrusted sender')
  })

  it('defaults to system, persists allowed values, rejects others', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mc-t-'))
    const h = createThemeHandlers(dir)
    expect(await h.getTheme()).toEqual({ ok: true, value: 'system' })
    expect(await h.saveTheme('dark')).toEqual({ ok: true, value: 'dark' })
    expect(await h.getTheme()).toEqual({ ok: true, value: 'dark' })
    for (const bad of ['blue', '', 1, null, { theme: 'dark' }])
      expect(await h.saveTheme(bad)).toMatchObject({ ok: false, code: 'invalid-request' })
    expect(JSON.parse(await readFile(join(dir, 'theme.json'), 'utf8'))).toEqual({ theme: 'dark' })
  })

  it('falls back to system when the file is corrupt', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mc-t-'))
    await import('node:fs/promises').then((f) =>
      f.writeFile(join(dir, 'theme.json'), '{"theme":"x"')
    )
    expect(await createThemeHandlers(dir).getTheme()).toEqual({ ok: true, value: 'system' })
  })
})
