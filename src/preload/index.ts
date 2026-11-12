import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type WindowApi } from '../shared/api'

// ipcRenderer를 그대로 노출하지 않고 채널별 함수로만 감싼다.
const api: WindowApi = {
  ping: () => ipcRenderer.invoke(IPC_CHANNELS.ping)
}

contextBridge.exposeInMainWorld('api', api)
