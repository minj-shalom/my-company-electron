import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { IPC_CHANNELS } from '../../shared/api'
import type { ApiResult } from '../../shared/result'
import type {
  VisitNotifySettings,
  VisitSeenResult,
  VisitSummary,
  VisitSummaryRequest
} from '../../shared/visit'
import { NoCompanyError } from '../company/company-context'
import { isTrustedSender } from '../ipc-guard'
import { trustedHandler } from '../domain-ipc'
import { isProjectId } from './visit-service'
import { visitServiceFor, visitStoreFor, type VisitRuntimeDeps } from './visit-runtime'

export interface VisitHandlers {
  getVisitSummary: (req: unknown) => Promise<ApiResult<VisitSummary>>
  markVisitSeen: () => Promise<ApiResult<VisitSeenResult>>
  getVisitNotify: () => Promise<ApiResult<VisitNotifySettings>>
  setVisitNotify: (req: unknown) => Promise<ApiResult<VisitNotifySettings>>
}

const fail = (
  code: 'invalid-request' | 'no-company' | 'internal',
  message: string
): ApiResult<never> => ({
  ok: false,
  code,
  message
})
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** 요청은 undefined 또는 `{ projectId? }`만 허용한다. 알 수 없는 키는 거부한다. */
function parseSummaryRequest(raw: unknown): VisitSummaryRequest | null {
  if (raw === undefined || raw === null) return {}
  if (!isRecord(raw)) return null
  if (Object.keys(raw).some((k) => k !== 'projectId')) return null
  if (raw.projectId === undefined) return {}
  return isProjectId(raw.projectId) ? { projectId: raw.projectId } : null
}

export function createVisitHandlers(deps: VisitRuntimeDeps): VisitHandlers {
  const call = async <T>(fn: () => Promise<T>): Promise<ApiResult<T>> => {
    try {
      return { ok: true, value: await fn() }
    } catch (e) {
      if (e instanceof NoCompanyError) return fail('no-company', '열린 회사가 없습니다.')
      return fail('internal', '방문 요약을 처리하지 못했습니다.')
    }
  }
  const store = visitStoreFor(deps.userDataDir)
  return {
    getVisitSummary: (raw) => {
      const req = parseSummaryRequest(raw)
      if (req === null) return Promise.resolve(fail('invalid-request', '요청이 올바르지 않습니다.'))
      return call(() => visitServiceFor(deps).summary(req))
    },
    // 입력을 받지 않는다. 시각은 main 시계로만 기록한다.
    markVisitSeen: () =>
      call(async () => ({ lastVisitAt: (await visitServiceFor(deps).markSeen()).toISOString() })),
    getVisitNotify: () => call(async () => ({ enabled: await store.loadNotifyEnabled() })),
    setVisitNotify: (raw) => {
      if (
        !isRecord(raw) ||
        Object.keys(raw).some((k) => k !== 'enabled') ||
        typeof raw.enabled !== 'boolean'
      )
        return Promise.resolve(fail('invalid-request', '알림 설정 값이 올바르지 않습니다.'))
      const enabled = raw.enabled
      return call(async () => {
        await store.saveNotifyEnabled(enabled)
        return { enabled }
      })
    }
  }
}

export function registerVisitHandlers(deps: VisitRuntimeDeps): void {
  const h = createVisitHandlers(deps)
  const handle = (channel: string, fn: (arg: unknown) => Promise<ApiResult<unknown>>): void => {
    ipcMain.handle(
      channel,
      trustedHandler<IpcMainInvokeEvent, ApiResult<unknown>>(isTrustedSender, fn)
    )
  }
  handle(IPC_CHANNELS.visitSummary, h.getVisitSummary)
  handle(IPC_CHANNELS.visitMarkSeen, () => h.markVisitSeen())
  handle(IPC_CHANNELS.visitNotifyGet, () => h.getVisitNotify())
  handle(IPC_CHANNELS.visitNotifySet, h.setVisitNotify)
}
