import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/api'
import type { ApiResult } from '../../shared/result'
import {
  ADAPTER_ID,
  type CredentialAdapterStatus,
  type CredentialDisconnectResult
} from '../../shared/publisher'
import { isTrustedSender } from '../ipc-guard'
import { CredentialServiceError, type CredentialService } from './credential-service'

/** IPC가 쓰는 보관소 창구는 상태·해제뿐이다. 값을 읽는 메서드는 이 타입에 없다. */
export type CredentialIpcService = Pick<CredentialService, 'status' | 'disconnect'>

const FAILURE: ApiResult<never> = {
  ok: false,
  code: 'internal',
  message: '외부 연결 정보를 처리하지 못했습니다.'
}

export function createCredentialHandlers(svc: CredentialIpcService): {
  getCredentialStatus: () => Promise<ApiResult<CredentialAdapterStatus[]>>
  disconnectCredential: (req: unknown) => Promise<ApiResult<CredentialDisconnectResult>>
} {
  return {
    getCredentialStatus: async () => {
      try {
        return { ok: true, value: await svc.status() }
      } catch {
        return FAILURE
      }
    },
    disconnectCredential: async (req) => {
      const id =
        typeof req === 'object' && req !== null
          ? (req as { adapterId?: unknown }).adapterId
          : undefined
      if (typeof id !== 'string' || !ADAPTER_ID.test(id))
        return { ok: false, code: 'invalid-request', message: '연결 대상이 올바르지 않습니다.' }
      try {
        return { ok: true, value: await svc.disconnect(id) }
      } catch (e) {
        if (e instanceof CredentialServiceError && e.code === 'unknown-adapter')
          return { ok: false, code: 'invalid-request', message: '알 수 없는 연결입니다.' }
        return FAILURE
      }
    }
  }
}

export function registerCredentialHandlers(svc: CredentialIpcService): void {
  const h = createCredentialHandlers(svc)
  ipcMain.handle(IPC_CHANNELS.credentialsStatus, (event) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted sender')
    return h.getCredentialStatus()
  })
  ipcMain.handle(IPC_CHANNELS.credentialsDisconnect, (event, req: unknown) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted sender')
    return h.disconnectCredential(req)
  })
}
