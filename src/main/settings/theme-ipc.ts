import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/api'
import type { ApiResult } from '../../shared/result'
import { isThemePreference, type ThemePreference } from '../../shared/theme'
import { isTrustedSender } from '../ipc-guard'
import { createThemeStore } from './theme-store'

export function createThemeHandlers(userDataDir: string): {
  getTheme: () => Promise<ApiResult<ThemePreference>>
  saveTheme: (req: unknown) => Promise<ApiResult<ThemePreference>>
} {
  const store = createThemeStore(userDataDir)
  const failure: ApiResult<never> = {
    ok: false,
    code: 'internal',
    message: '테마 설정을 처리하지 못했습니다.'
  }
  return {
    getTheme: async () => {
      try {
        return { ok: true, value: await store.load() }
      } catch {
        return failure
      }
    },
    saveTheme: async (req) => {
      if (!isThemePreference(req))
        return { ok: false, code: 'invalid-request', message: '테마 값이 올바르지 않습니다.' }
      try {
        await store.save(req)
        return { ok: true, value: req }
      } catch {
        return failure
      }
    }
  }
}

export function registerThemeHandlers(userDataDir: string): void {
  const h = createThemeHandlers(userDataDir)
  ipcMain.handle(IPC_CHANNELS.settingsThemeGet, (event) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted sender')
    return h.getTheme()
  })
  ipcMain.handle(IPC_CHANNELS.settingsThemeSave, (event, req: unknown) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted sender')
    return h.saveTheme(req)
  })
}
