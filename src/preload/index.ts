import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import { IPC_CHANNELS, type WindowApi } from '../shared/api'
import type { ApiResult } from '../shared/result'

// ipcRenderer를 그대로 노출하지 않고 채널별 함수로만 감싼다.
// main 핸들러가 아직 없는 도메인 메서드는 IPC 채널을 노출하지 않고 로컬에서 not-implemented를 돌려준다.
// 인터페이스를 optional로 만들지 않아 renderer는 mock/실구현을 같은 타입으로 받는다. 핸들러가 생기면 invoke로 교체한다.
const notImplemented = (): Promise<ApiResult<never>> =>
  Promise.resolve({ ok: false, code: 'not-implemented', message: '아직 지원하지 않는 기능입니다.' })

const api: WindowApi = {
  ping: () => ipcRenderer.invoke(IPC_CHANNELS.ping),
  startRun: (req) => ipcRenderer.invoke(IPC_CHANNELS.runStart, req),
  cancelRun: (runId) => ipcRenderer.invoke(IPC_CHANNELS.runCancel, runId),
  createCompany: (req) => ipcRenderer.invoke(IPC_CHANNELS.companyCreate, req),
  selectCompanyFolder: (purpose) => ipcRenderer.invoke(IPC_CHANNELS.companySelectFolder, purpose),
  openCompany: (req) => ipcRenderer.invoke(IPC_CHANNELS.companyOpen, req),
  getCurrentCompany: () => ipcRenderer.invoke(IPC_CHANNELS.companyCurrent),
  getCompany: notImplemented,
  listEmployees: notImplemented,
  getOrg: notImplemented,
  listTickets: notImplemented,
  getTicket: notImplemented,
  listDecisions: notImplemented,
  resolveDecision: notImplemented,
  detectProviders: notImplemented,
  testProviderConnection: notImplemented,
  getWeeklyLimits: notImplemented,
  saveWeeklyLimits: notImplemented,
  onRunEvent: (listener) => {
    // IpcRendererEvent를 renderer에 넘기지 않고 payload만 전달한다.
    const handler = (_: IpcRendererEvent, event: Parameters<typeof listener>[0]): void =>
      listener(event)
    ipcRenderer.on(IPC_CHANNELS.runEvent, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.runEvent, handler)
  }
}

contextBridge.exposeInMainWorld('api', api)
