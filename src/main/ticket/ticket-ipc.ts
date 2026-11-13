import { MAX_TICKET_BODY_CHARS, type Ticket } from '../../shared/ticket'
import type { ApiResult } from '../../shared/result'
import { NoCompanyError, type CompanyContext } from '../company/company-context'
import { projectServiceFor } from '../project/project-ipc'
import { sharedRepository } from '../repository/shared-repository'
import { TicketService } from './ticket-service'

export interface TicketWriteIpcDeps {
  context: CompanyContext
  homeDir?: string
}

export interface TicketWriteHandlers {
  createTicket: (req: unknown) => Promise<ApiResult<Ticket>>
  updateTicket: (req: unknown) => Promise<ApiResult<Ticket>>
}

/** 열린 회사의 저장소와 프로젝트 서비스로 만든 티켓 서비스. 정기 티켓(T-049)도 이 함수로 얻어 `create`를 부른다. */
export function ticketServiceFor(deps: TicketWriteIpcDeps): TicketService {
  const fs = deps.context.requireOpenCompany().fs
  const repo = sharedRepository(fs)
  const projects = projectServiceFor(deps)
  return new TicketService({
    fs,
    exclusive: (task) => repo.runExclusive(task),
    employeeIds: async () => new Set((await repo.listEmployees()).org.employees.map((e) => e.id)),
    projects: async () => {
      const r = await projects.list()
      if (!r.ok) throw new Error('projects unavailable')
      return r.value.items
    },
    getTicket: async (id) => {
      const r = await repo.getTicket(id)
      if (!r.ok) return { ok: false, code: 'internal', message: '티켓을 저장하지 못했습니다.' }
      const t = r.value
      return {
        ok: true,
        value:
          t.body.length > MAX_TICKET_BODY_CHARS
            ? { ...t, body: t.body.slice(0, MAX_TICKET_BODY_CHARS), bodyTruncated: true }
            : { ...t, bodyTruncated: false }
      }
    }
  })
}

export function createTicketWriteHandlers(deps: TicketWriteIpcDeps): TicketWriteHandlers {
  const call =
    (fn: (svc: TicketService, req: unknown) => Promise<ApiResult<Ticket>>) =>
    async (req: unknown): Promise<ApiResult<Ticket>> => {
      try {
        return await fn(ticketServiceFor(deps), req)
      } catch (e) {
        if (e instanceof NoCompanyError)
          return { ok: false, code: 'no-company', message: '열린 회사가 없습니다.' }
        return { ok: false, code: 'internal', message: '요청을 처리하지 못했습니다.' }
      }
    }
  return {
    createTicket: call((s, r) => s.create(r)),
    updateTicket: call((s, r) => s.update(r))
  }
}
