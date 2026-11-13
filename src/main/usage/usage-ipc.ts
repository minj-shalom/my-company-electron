import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/api'
import type { ApiResult } from '../../shared/result'
import { validateUsageSettings, type UsageSettings, type UsageWidgetData } from '../../shared/usage'
import { NoCompanyError } from '../company/company-context'
import { isTrustedSender } from '../ipc-guard'
import { pick, createUsageSettingsStore } from './usage-settings-store'
import { usageServiceFor, type UsageRuntimeDeps } from './usage-runtime'

/** 예외는 고정 문구로 바꾼다 (내부 경로 노출 방지). */
async function guarded<T>(task: () => Promise<T>): Promise<ApiResult<T>> {
  try {
    return { ok: true, value: await task() }
  } catch (e) {
    if (e instanceof NoCompanyError)
      return { ok: false, code: 'no-company', message: '열린 회사가 없습니다.' }
    return { ok: false, code: 'internal', message: '사용량 처리에 실패했습니다.' }
  }
}

export function createUsageHandlers(deps: UsageRuntimeDeps): {
  getUsageWidget: () => Promise<ApiResult<UsageWidgetData>>
  getUsageSettings: () => Promise<ApiResult<UsageSettings>>
  saveUsageSettings: (req: unknown) => Promise<ApiResult<UsageSettings>>
} {
  const settings = createUsageSettingsStore(deps.userDataDir)
  return {
    getUsageWidget: () => guarded(() => usageServiceFor(deps).widget()),
    getUsageSettings: () => guarded(() => settings.load()),
    saveUsageSettings: async (req) => {
      if (!validateUsageSettings(req))
        return {
          ok: false,
          code: 'invalid-request',
          message: '사용량 설정 값이 올바르지 않습니다.'
        }
      const value = pick(req)
      return guarded(async () => {
        await settings.save(value)
        return value
      })
    }
  }
}

export function registerUsageHandlers(deps: UsageRuntimeDeps): void {
  const h = createUsageHandlers(deps)
  const trusted =
    <A extends unknown[], R>(fn: (...a: A) => R) =>
    (event: Parameters<typeof isTrustedSender>[0], ...a: A): R => {
      if (!isTrustedSender(event)) throw new Error('Untrusted sender')
      return fn(...a)
    }
  ipcMain.handle(
    IPC_CHANNELS.usageWidget,
    trusted(() => h.getUsageWidget())
  )
  ipcMain.handle(
    IPC_CHANNELS.usageSettingsGet,
    trusted(() => h.getUsageSettings())
  )
  ipcMain.handle(
    IPC_CHANNELS.usageSettingsSave,
    trusted((req: unknown) => h.saveUsageSettings(req))
  )
}
