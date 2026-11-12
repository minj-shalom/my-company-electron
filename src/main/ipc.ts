import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { IPC_CHANNELS } from '../shared/api'

// 앱 자신의 페이지에서 온 요청만 처리한다.
function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url ?? ''
  const dev = process.env['ELECTRON_RENDERER_URL']
  return url.startsWith('file://') || (dev !== undefined && url.startsWith(dev))
}

export function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.ping, (event) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted sender')
    return 'pong'
  })
}
