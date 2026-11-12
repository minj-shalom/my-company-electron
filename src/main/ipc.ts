import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../shared/api'
import { isTrustedSender } from './ipc-guard'

export function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.ping, (event) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted sender')
    return 'pong'
  })
}
