import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../shared/api'
import type { RunStartResult } from '../shared/run'
import { isTrustedSender } from './ipc-guard'
import type { ProviderAdapter } from './providers/types'

const MAX_RUN_ID_LENGTH = 64

export function registerRunHandlers(runner: ProviderAdapter): void {
  ipcMain.handle(IPC_CHANNELS.runStart, (event, req: unknown): RunStartResult => {
    if (!isTrustedSender(event)) throw new Error('Untrusted sender')
    const sender = event.sender
    return runner.start(req, (runEvent) => {
      // 창이 닫힌 뒤 도착한 이벤트는 버린다.
      if (!sender.isDestroyed()) sender.send(IPC_CHANNELS.runEvent, runEvent)
    })
  })

  ipcMain.handle(IPC_CHANNELS.runCancel, (event, runId: unknown): boolean => {
    if (!isTrustedSender(event)) throw new Error('Untrusted sender')
    if (typeof runId !== 'string' || runId.length === 0 || runId.length > MAX_RUN_ID_LENGTH)
      return false
    return runner.cancel(runId)
  })
}
