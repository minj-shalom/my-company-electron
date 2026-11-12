import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { IPC_CHANNELS } from '../shared/api'
import type { OrgSnapshot } from '../shared/org'
import type { ConnectionTestResult, ProviderDetection, WeeklyLimit } from '../shared/provider'
import type { ApiResult } from '../shared/result'
import { isTrustedSender } from './ipc-guard'
import { NoCompanyError, type CompanyContext } from './company/company-context'
import { buildOrgSnapshot } from './org/org-snapshot'
import { isProviderCliId, type ProviderService } from './providers/provider-service'
import { parseWeeklyLimits, type WeeklyLimitsStore } from './settings/weekly-limits-store'

export interface DomainDeps {
  context: CompanyContext
  providers: ProviderService
  limits: WeeklyLimitsStore
}

const fail = (
  code: 'invalid-request' | 'no-company' | 'internal',
  message: string
): ApiResult<never> => ({
  ok: false,
  code,
  message
})

/** 예외를 ApiResult로 바꾼다. 원본 오류에는 내부 경로가 있을 수 있어 고정 문구만 돌려준다. */
async function guarded<T>(task: () => Promise<T>): Promise<ApiResult<T>> {
  try {
    return { ok: true, value: await task() }
  } catch (e) {
    if (e instanceof NoCompanyError) return fail('no-company', '열린 회사가 없습니다.')
    return fail('internal', '요청을 처리하지 못했습니다.')
  }
}

export function createDomainHandlers(deps: DomainDeps): {
  getOrg: () => Promise<ApiResult<OrgSnapshot>>
  detectProviders: () => Promise<ApiResult<ProviderDetection[]>>
  testProviderConnection: (provider: unknown) => Promise<ApiResult<ConnectionTestResult>>
  getWeeklyLimits: () => Promise<ApiResult<WeeklyLimit[]>>
  saveWeeklyLimits: (req: unknown) => Promise<ApiResult<WeeklyLimit[]>>
} {
  return {
    // SafeFs는 열린 회사 컨텍스트에서만 얻는다 (renderer가 경로를 넘기지 않는다).
    getOrg: () => guarded(() => buildOrgSnapshot(deps.context.requireOpenCompany().fs)),
    detectProviders: () => guarded(() => deps.providers.detect()),
    testProviderConnection: async (provider) => {
      if (!isProviderCliId(provider)) return fail('invalid-request', '지원하지 않는 제공자입니다.')
      return guarded(() => deps.providers.testConnection(provider))
    },
    getWeeklyLimits: () => guarded(() => deps.limits.load()),
    saveWeeklyLimits: async (req) => {
      const limits = parseWeeklyLimits(req)
      if (limits === null) return fail('invalid-request', '주간 한도 값이 올바르지 않습니다.')
      return guarded(async () => {
        await deps.limits.save(limits)
        return limits
      })
    }
  }
}

export function registerDomainHandlers(deps: DomainDeps): void {
  const h = createDomainHandlers(deps)
  const handle = (channel: string, fn: (arg: unknown) => Promise<ApiResult<unknown>>): void => {
    ipcMain.handle(channel, (event: IpcMainInvokeEvent, arg: unknown) => {
      if (!isTrustedSender(event)) throw new Error('Untrusted sender')
      return fn(arg)
    })
  }
  handle(IPC_CHANNELS.orgGet, () => h.getOrg())
  handle(IPC_CHANNELS.providerDetect, () => h.detectProviders())
  handle(IPC_CHANNELS.providerTestConnection, h.testProviderConnection)
  handle(IPC_CHANNELS.settingsWeeklyLimitsGet, () => h.getWeeklyLimits())
  handle(IPC_CHANNELS.settingsWeeklyLimitsSave, h.saveWeeklyLimits)
}
