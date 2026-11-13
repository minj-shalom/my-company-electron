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
  getOrg: () => ipcRenderer.invoke(IPC_CHANNELS.orgGet),
  listTickets: (status) => ipcRenderer.invoke(IPC_CHANNELS.ticketList, status),
  getTicket: (id) => ipcRenderer.invoke(IPC_CHANNELS.ticketGet, id),
  moveTicket: (req) => ipcRenderer.invoke(IPC_CHANNELS.ticketMove, req),
  createTicket: (req) => ipcRenderer.invoke(IPC_CHANNELS.ticketCreate, req),
  updateTicket: (req) => ipcRenderer.invoke(IPC_CHANNELS.ticketUpdate, req),
  listDecisions: (status) => ipcRenderer.invoke(IPC_CHANNELS.decisionList, status),
  resolveDecision: (req) => ipcRenderer.invoke(IPC_CHANNELS.decisionResolve, req),
  listEmployeeTemplates: () => ipcRenderer.invoke(IPC_CHANNELS.employeeListTemplates),
  createEmployee: (req) => ipcRenderer.invoke(IPC_CHANNELS.employeeCreate, req),
  updateEmployee: (req) => ipcRenderer.invoke(IPC_CHANNELS.employeeUpdate, req),
  moveEmployee: (req) => ipcRenderer.invoke(IPC_CHANNELS.employeeMove, req),
  retireEmployee: (req) => ipcRenderer.invoke(IPC_CHANNELS.employeeRetire, req),
  hirePm: () => ipcRenderer.invoke(IPC_CHANNELS.companyHirePm),
  firstHire: (req) => ipcRenderer.invoke(IPC_CHANNELS.companyFirstHire, req),
  selectProjectFolder: () => ipcRenderer.invoke(IPC_CHANNELS.projectSelectFolder),
  listProjects: () => ipcRenderer.invoke(IPC_CHANNELS.projectList),
  addProject: (req) => ipcRenderer.invoke(IPC_CHANNELS.projectAdd, req),
  renameProject: (req) => ipcRenderer.invoke(IPC_CHANNELS.projectRename, req),
  archiveProject: (req) => ipcRenderer.invoke(IPC_CHANNELS.projectArchive, req),
  restoreProject: (req) => ipcRenderer.invoke(IPC_CHANNELS.projectRestore, req),
  setProjectType: (req) => ipcRenderer.invoke(IPC_CHANNELS.projectSetType, req),
  setProjectPm: (req) => ipcRenderer.invoke(IPC_CHANNELS.projectSetPm, req),
  clearProjectPm: (req) => ipcRenderer.invoke(IPC_CHANNELS.projectClearPm, req),
  assignProjectEmployee: (req) => ipcRenderer.invoke(IPC_CHANNELS.projectAssignEmployee, req),
  unassignProjectEmployee: (req) => ipcRenderer.invoke(IPC_CHANNELS.projectUnassignEmployee, req),
  listEmployeeProjects: (req) => ipcRenderer.invoke(IPC_CHANNELS.employeeProjects, req),
  getPolicy: (req) => ipcRenderer.invoke(IPC_CHANNELS.policyGet, req),
  savePolicy: (req) => ipcRenderer.invoke(IPC_CHANNELS.policySave, req),
  listPolicySummaries: () => ipcRenderer.invoke(IPC_CHANNELS.policyListSummaries),
  getKillSwitch: () => ipcRenderer.invoke(IPC_CHANNELS.gateKillSwitchGet),
  setKillSwitch: (req) => ipcRenderer.invoke(IPC_CHANNELS.gateKillSwitchSet, req),
  getAuditSummary: (req) => ipcRenderer.invoke(IPC_CHANNELS.auditSummary, req),
  getQuarantinedEmployees: () => ipcRenderer.invoke(IPC_CHANNELS.employeeQuarantined),
  restoreIntegrity: () => ipcRenderer.invoke(IPC_CHANNELS.integrityRestore),
  acceptIntegrity: () => ipcRenderer.invoke(IPC_CHANNELS.integrityAccept),
  detectProviders: () => ipcRenderer.invoke(IPC_CHANNELS.providerDetect),
  testProviderConnection: (provider) =>
    ipcRenderer.invoke(IPC_CHANNELS.providerTestConnection, provider),
  getWeeklyLimits: () => ipcRenderer.invoke(IPC_CHANNELS.settingsWeeklyLimitsGet),
  saveWeeklyLimits: (req) => ipcRenderer.invoke(IPC_CHANNELS.settingsWeeklyLimitsSave, req),
  onRunEvent: (listener) => {
    // IpcRendererEvent를 renderer에 넘기지 않고 payload만 전달한다.
    const handler = (_: IpcRendererEvent, event: Parameters<typeof listener>[0]): void =>
      listener(event)
    ipcRenderer.on(IPC_CHANNELS.runEvent, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.runEvent, handler)
  }
}

contextBridge.exposeInMainWorld('api', api)
