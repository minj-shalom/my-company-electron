import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { IPC_CHANNELS } from '../shared/api'
import type { Decision, DecisionList } from '../shared/decision'
import type { OrgSnapshot } from '../shared/org'
import {
  MAX_TICKET_BODY_CHARS,
  TICKET_STATUSES,
  type Ticket,
  type TicketList,
  type TicketStatus
} from '../shared/ticket'
import type { ConnectionTestResult, ProviderDetection, WeeklyLimit } from '../shared/provider'
import type { ApiResult } from '../shared/result'
import { isTrustedSender } from './ipc-guard'
import { NoCompanyError, type CompanyContext } from './company/company-context'
import { normalizeMemo } from './repository/decision-memo'
import { MAX_MEMO_LENGTH, DECISION_ID, TICKET_ID } from './repository/ids'
import type { FileCompanyRepository } from './repository/file-repository'
import { sharedRepository } from './repository/shared-repository'
import { buildOrgSnapshot } from './org/org-snapshot'
import { createEmployeeHandlers, type EmployeeHandlers } from './employee/employee-ipc'
import type { AssignmentSource } from './employee/employee-service'
import { createTicketWriteHandlers, type TicketWriteHandlers } from './ticket/ticket-ipc'
import { createProjectHandlers, type ProjectHandlers } from './project/project-ipc'
import { isProviderCliId, type ProviderService } from './providers/provider-service'
import { parseWeeklyLimits, type WeeklyLimitsStore } from './settings/weekly-limits-store'

export interface DomainDeps {
  context: CompanyContext
  providers: ProviderService
  limits: WeeklyLimitsStore
  /** 직원 프로젝트 배정 조회. T-045 전에는 생략하며 항상 빈 목록으로 본다. */
  assignments?: AssignmentSource
  /** 프로젝트 경로 검증에서 "홈 폴더"로 볼 경로. 테스트에서만 바꾼다. */
  homeDir?: string
}

const fail = (
  code: 'invalid-request' | 'no-company' | 'internal' | 'not-found' | 'conflict',
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

function repositoryFor(deps: DomainDeps): FileCompanyRepository {
  return sharedRepository(deps.context.requireOpenCompany().fs)
}

const DECISION_STATUS_VALUES: readonly unknown[] = ['pending', 'done']
const MAX_CHOICE_LENGTH = 20
const RESOLVE_INTERNAL: Parameters<typeof fail> = ['internal', '요청을 처리하지 못했습니다.']
const RESOLVE_FAILURES: Record<string, Parameters<typeof fail>> = {
  'invalid-request': ['invalid-request', '카드에 없는 선택지이거나 허용되지 않는 대상입니다.'],
  'not-found': ['not-found', '결정 카드를 찾을 수 없습니다.'],
  conflict: ['conflict', '이미 처리된 결정입니다.']
}

const TICKET_STATUS_VALUES: readonly unknown[] = TICKET_STATUSES
const TICKET_FAILURES: Record<string, Parameters<typeof fail>> = {
  'invalid-request': ['invalid-request', '허용되지 않거나 읽을 수 없는 티켓입니다.'],
  'not-found': ['not-found', '티켓을 찾을 수 없습니다.'],
  conflict: ['conflict', '이동할 상태에 같은 번호의 다른 티켓 파일이 이미 있습니다.']
}

/** 본문이 너무 길면 자르고 표시한다. 문자 수 기준이라 surrogate pair 한가운데를 자르지 않게 한다. */
function limitBody(t: Ticket): Ticket {
  if (t.body.length <= MAX_TICKET_BODY_CHARS) return { ...t, bodyTruncated: false }
  let end = MAX_TICKET_BODY_CHARS
  const code = t.body.charCodeAt(end - 1)
  if (code >= 0xd800 && code <= 0xdbff) end -= 1
  return { ...t, body: t.body.slice(0, end), bodyTruncated: true }
}

/** 저장소 결과를 고정 문구로 바꿔 돌려준다 (파일명/경로 노출 방지). */
function mapTicketResult(r: ApiResult<ApiResult<Ticket>>): ApiResult<Ticket> {
  if (!r.ok) return r
  if (r.value.ok) return { ok: true, value: limitBody(r.value.value) }
  return fail(...(TICKET_FAILURES[r.value.code] ?? RESOLVE_INTERNAL))
}

export function createDomainHandlers(deps: DomainDeps): {
  getOrg: () => Promise<ApiResult<OrgSnapshot>>
  detectProviders: () => Promise<ApiResult<ProviderDetection[]>>
  testProviderConnection: (provider: unknown) => Promise<ApiResult<ConnectionTestResult>>
  getWeeklyLimits: () => Promise<ApiResult<WeeklyLimit[]>>
  saveWeeklyLimits: (req: unknown) => Promise<ApiResult<WeeklyLimit[]>>
  listTickets: (status: unknown) => Promise<ApiResult<TicketList>>
  getTicket: (id: unknown) => Promise<ApiResult<Ticket>>
  moveTicket: (req: unknown) => Promise<ApiResult<Ticket>>
  listDecisions: (status: unknown) => Promise<ApiResult<DecisionList>>
  resolveDecision: (req: unknown) => Promise<ApiResult<Decision>>
} & EmployeeHandlers &
  ProjectHandlers &
  TicketWriteHandlers {
  return {
    ...createTicketWriteHandlers({ context: deps.context, homeDir: deps.homeDir }),
    ...createProjectHandlers({ context: deps.context, homeDir: deps.homeDir }),
    ...createEmployeeHandlers({
      context: deps.context,
      repository: () => repositoryFor(deps),
      assignments: deps.assignments
    }),
    // SafeFs는 열린 회사 컨텍스트에서만 얻는다 (renderer가 경로를 넘기지 않는다).
    getOrg: () => guarded(() => buildOrgSnapshot(deps.context.requireOpenCompany().fs)),
    detectProviders: () => guarded(() => deps.providers.detect()),
    testProviderConnection: async (provider) => {
      if (!isProviderCliId(provider)) return fail('invalid-request', '지원하지 않는 제공자입니다.')
      return guarded(() => deps.providers.testConnection(provider))
    },
    // 손상 티켓이 있어도 목록 전체는 깨지지 않는다. 읽지 못한 항목은 상대 경로와 고정 분류만 올린다.
    listTickets: async (status) => {
      if (status !== undefined && !TICKET_STATUS_VALUES.includes(status))
        return fail('invalid-request', '티켓 상태 값이 올바르지 않습니다.')
      return guarded(async () => {
        const { items, issues } = await repositoryFor(deps).listTickets(status as TicketStatus)
        return {
          items: items.map(limitBody),
          unreadable: issues.map((i) => ({ path: i.path, reason: i.reason ?? 'unreadable' }))
        }
      })
    },
    getTicket: async (id) => {
      if (typeof id !== 'string' || !TICKET_ID.test(id))
        return fail('invalid-request', '티켓 id가 올바르지 않습니다.')
      return mapTicketResult(await guarded(() => repositoryFor(deps).getTicket(id)))
    },
    moveTicket: async (req) => {
      if (typeof req !== 'object' || req === null || Array.isArray(req))
        return fail('invalid-request', '요청이 올바르지 않습니다.')
      const { id, to } = req as Record<string, unknown>
      if (typeof id !== 'string' || !TICKET_ID.test(id))
        return fail('invalid-request', '티켓 id가 올바르지 않습니다.')
      if (!TICKET_STATUS_VALUES.includes(to))
        return fail('invalid-request', '티켓 상태 값이 올바르지 않습니다.')
      // 필요한 필드만 복사해 넘긴다 (추가 필드 전달 차단).
      return mapTicketResult(
        await guarded(() => repositoryFor(deps).moveTicket(id, to as TicketStatus))
      )
    },
    // 읽지 못한 카드는 목록에서 빠지고 나머지는 그대로 돌려준다 (저장소가 issues로 따로 수집한다).
    listDecisions: async (status) => {
      if (status !== undefined && !DECISION_STATUS_VALUES.includes(status))
        return fail('invalid-request', '결정 상태 값이 올바르지 않습니다.')
      return guarded(async () => {
        const { items, issues } = await repositoryFor(deps).listDecisions(
          status as Decision['status']
        )
        // 오류 원문(message)은 버리고 상대 경로와 고정 분류만 renderer로 보낸다.
        return {
          items,
          unreadable: issues.map((i) => ({ path: i.path, reason: i.reason ?? 'unreadable' }))
        }
      })
    },
    resolveDecision: async (req) => {
      if (typeof req !== 'object' || req === null || Array.isArray(req))
        return fail('invalid-request', '요청이 올바르지 않습니다.')
      const { id, choice, memo } = req as Record<string, unknown>
      if (typeof id !== 'string' || !DECISION_ID.test(id))
        return fail('invalid-request', '결정 id가 올바르지 않습니다.')
      if (typeof choice !== 'string' || choice.length === 0 || choice.length > MAX_CHOICE_LENGTH)
        return fail('invalid-request', '선택지가 올바르지 않습니다.')
      if (
        memo !== undefined &&
        (typeof memo !== 'string' || memo.length > MAX_MEMO_LENGTH || normalizeMemo(memo) === null)
      )
        return fail('invalid-request', '메모가 올바르지 않습니다.')
      // 필요한 필드만 복사해 넘긴다 (추가 필드 전달 차단).
      const r = await guarded(() => repositoryFor(deps).resolveDecision({ id, choice, memo }))
      if (!r.ok) return r
      // 저장소의 실패 사유는 고정 문구로 바꿔 돌려준다 (파일명/경로 노출 방지).
      return r.value.ok ? r.value : fail(...(RESOLVE_FAILURES[r.value.code] ?? RESOLVE_INTERNAL))
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

/** 신뢰하지 않는 발신자면 fn을 호출하지 않고 거부한다. Electron과 분리해 테스트한다. */
export function trustedHandler<E, R>(
  isTrusted: (event: E) => boolean,
  fn: (arg: unknown) => Promise<R>
): (event: E, arg: unknown) => Promise<R> {
  return async (event, arg) => {
    if (!isTrusted(event)) throw new Error('Untrusted sender')
    return fn(arg)
  }
}

export function registerDomainHandlers(deps: DomainDeps): void {
  const h = createDomainHandlers(deps)
  const handle = (channel: string, fn: (arg: unknown) => Promise<ApiResult<unknown>>): void => {
    ipcMain.handle(
      channel,
      trustedHandler<IpcMainInvokeEvent, ApiResult<unknown>>(isTrustedSender, fn)
    )
  }
  handle(IPC_CHANNELS.orgGet, () => h.getOrg())
  handle(IPC_CHANNELS.providerDetect, () => h.detectProviders())
  handle(IPC_CHANNELS.providerTestConnection, h.testProviderConnection)
  handle(IPC_CHANNELS.ticketList, h.listTickets)
  handle(IPC_CHANNELS.ticketGet, h.getTicket)
  handle(IPC_CHANNELS.ticketMove, h.moveTicket)
  handle(IPC_CHANNELS.ticketCreate, h.createTicket)
  handle(IPC_CHANNELS.ticketUpdate, h.updateTicket)
  handle(IPC_CHANNELS.decisionList, h.listDecisions)
  handle(IPC_CHANNELS.decisionResolve, h.resolveDecision)
  handle(IPC_CHANNELS.employeeListTemplates, () => h.listTemplates())
  handle(IPC_CHANNELS.employeeCreate, h.createEmployee)
  handle(IPC_CHANNELS.employeeUpdate, h.updateEmployee)
  handle(IPC_CHANNELS.employeeMove, h.moveEmployee)
  handle(IPC_CHANNELS.employeeRetire, h.retireEmployee)
  handle(IPC_CHANNELS.companyHirePm, () => h.hirePm())
  handle(IPC_CHANNELS.companyFirstHire, h.firstHire)
  handle(IPC_CHANNELS.projectList, () => h.list())
  handle(IPC_CHANNELS.projectAdd, h.add)
  handle(IPC_CHANNELS.projectRename, h.rename)
  handle(IPC_CHANNELS.projectArchive, h.archive)
  handle(IPC_CHANNELS.projectRestore, h.restore)
  handle(IPC_CHANNELS.projectSetType, h.setType)
  handle(IPC_CHANNELS.projectSetPm, h.setPm)
  handle(IPC_CHANNELS.projectClearPm, h.clearPm)
  // 다이얼로그는 main에서만 연다. renderer는 입력 없이 호출하고, 고른 경로 문자열만 받는다 (입력은 무시한다).
  ipcMain.handle(IPC_CHANNELS.projectSelectFolder, (event) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted sender')
    const win = BrowserWindow.fromWebContents(event.sender)
    return h.selectFolder(async () => {
      const options = {
        title: '프로젝트 폴더 선택',
        properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[]
      }
      const result = win
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options)
      return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
    })
  })
  handle(IPC_CHANNELS.settingsWeeklyLimitsGet, () => h.getWeeklyLimits())
  handle(IPC_CHANNELS.settingsWeeklyLimitsSave, h.saveWeeklyLimits)
}
