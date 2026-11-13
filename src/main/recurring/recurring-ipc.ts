import type { ApiResult } from '../../shared/result'
import type { RecurringDefinition, RecurringList } from '../../shared/recurring'
import { NoCompanyError, type CompanyContext } from '../company/company-context'
import { policyServiceFor } from '../policy/policy-ipc'
import { projectServiceFor } from '../project/project-ipc'
import { readProjectItems } from '../project/assignments-store'
import { sharedRepository } from '../repository/shared-repository'
import { ticketServiceFor } from '../ticket/ticket-ipc'
import type { PolicyHoursEntry } from '../scheduler/scheduler'
import type { DayClock } from './recurring-schedule'
import { RecurringService } from './recurring-service'

export interface RecurringIpcDeps {
  context: CompanyContext
  homeDir?: string
  clock?: DayClock
}

export interface RecurringHandlers {
  listRecurring: () => Promise<ApiResult<RecurringList>>
  addRecurring: (req: unknown) => Promise<ApiResult<RecurringDefinition>>
  updateRecurring: (req: unknown) => Promise<ApiResult<RecurringDefinition>>
  setRecurringStatus: (req: unknown) => Promise<ApiResult<RecurringDefinition>>
  removeRecurring: (req: unknown) => Promise<ApiResult<{ id: string }>>
}

/** 열린 회사에 묶인 서비스. 스케줄러 틱 전 훅(`materialize`)도 이 함수로 얻는다. */
export function recurringServiceFor(deps: RecurringIpcDeps): RecurringService {
  const fs = deps.context.requireOpenCompany().fs
  const repo = sharedRepository(fs)
  const projects = projectServiceFor(deps)
  return new RecurringService({
    fs,
    exclusive: (task) => repo.runExclusive(task),
    tickets: ticketServiceFor(deps),
    projects: async () => {
      const r = await projects.list()
      if (!r.ok) throw new Error('projects unavailable')
      return r.value.items
    },
    employeeIds: async () => new Set((await repo.listEmployees()).org.employees.map((e) => e.id)),
    loadPolicyHours: async (): Promise<PolicyHoursEntry[]> => {
      const svc = policyServiceFor({ context: deps.context })
      const out: PolicyHoursEntry[] = []
      for (const p of await readProjectItems(fs)) {
        const r = await svc.get({ projectId: p.id })
        out.push(
          r.ok
            ? { projectId: p.id, hours: r.value.values.activeHours }
            : { projectId: p.id, hours: null, unreadable: true }
        )
      }
      return out
    },
    clock: deps.clock ?? { now: () => new Date() }
  })
}

export function createRecurringHandlers(deps: RecurringIpcDeps): RecurringHandlers {
  const call =
    <A extends unknown[], T>(fn: (svc: RecurringService, ...args: A) => Promise<ApiResult<T>>) =>
    async (...args: A): Promise<ApiResult<T>> => {
      try {
        return await fn(recurringServiceFor(deps), ...args)
      } catch (e) {
        if (e instanceof NoCompanyError)
          return { ok: false, code: 'no-company', message: '열린 회사가 없습니다.' }
        return { ok: false, code: 'internal', message: '요청을 처리하지 못했습니다.' }
      }
    }
  return {
    listRecurring: call((s) => s.list()),
    addRecurring: call((s, r: unknown) => s.add(r)),
    updateRecurring: call((s, r: unknown) => s.update(r)),
    setRecurringStatus: call((s, r: unknown) => s.setStatus(r)),
    removeRecurring: call((s, r: unknown) => s.remove(r))
  }
}
