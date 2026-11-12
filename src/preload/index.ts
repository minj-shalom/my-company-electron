import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import { IPC_CHANNELS, type WindowApi } from '../shared/api'

// ipcRenderer를 그대로 노출하지 않고 채널별 함수로만 감싼다.
const api: WindowApi = {
  ping: () => ipcRenderer.invoke(IPC_CHANNELS.ping),
  startRun: (req) => ipcRenderer.invoke(IPC_CHANNELS.runStart, req),
  cancelRun: (runId) => ipcRenderer.invoke(IPC_CHANNELS.runCancel, runId),
  onRunEvent: (listener) => {
    // IpcRendererEvent를 renderer에 넘기지 않고 payload만 전달한다.
    const handler = (_: IpcRendererEvent, event: Parameters<typeof listener>[0]): void =>
      listener(event)
    ipcRenderer.on(IPC_CHANNELS.runEvent, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.runEvent, handler)
  }
}

contextBridge.exposeInMainWorld('api', api)
