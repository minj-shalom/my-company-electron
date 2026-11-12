import type { FirstHireResult, HirePmResult } from '../../shared/company-hire'
import type { EmployeeChangeResult, EmployeeTemplateInfo } from '../../shared/employee-change'
import type { ApiResult } from '../../shared/result'
import { NoCompanyError, type CompanyContext } from '../company/company-context'
import type { FileCompanyRepository } from '../repository/file-repository'
import type { SafeFs } from '../repository/safe-fs'
import { EmployeeService, NO_ASSIGNMENTS, type AssignmentSource } from './employee-service'
import { EMPLOYEE_TEMPLATES } from './templates'

export interface EmployeeIpcDeps {
  context: CompanyContext
  /** 열린 회사의 저장소. 쓰기 직렬화 큐를 다른 도메인 쓰기와 공유하려고 같은 인스턴스를 받는다. */
  repository: () => FileCompanyRepository
  assignments?: AssignmentSource
}

export interface EmployeeHandlers {
  listTemplates: () => Promise<ApiResult<EmployeeTemplateInfo[]>>
  createEmployee: (req: unknown) => Promise<ApiResult<EmployeeChangeResult>>
  updateEmployee: (req: unknown) => Promise<ApiResult<EmployeeChangeResult>>
  moveEmployee: (req: unknown) => Promise<ApiResult<EmployeeChangeResult>>
  retireEmployee: (req: unknown) => Promise<ApiResult<EmployeeChangeResult>>
  hirePm: () => Promise<ApiResult<HirePmResult>>
  firstHire: (req: unknown) => Promise<ApiResult<FirstHireResult>>
}

const services = new WeakMap<SafeFs, EmployeeService>()

/**
 * renderer가 보낸 요청은 항상 `ceo-ui`로 처리한다. `actor`는 요청 필드가 아니므로 위조할 수 없고
 * (알 수 없는 키는 거부된다) `approved-proposal`은 main 코드(T-046)만 서비스를 직접 호출해 쓴다.
 */
export function createEmployeeHandlers(deps: EmployeeIpcDeps): EmployeeHandlers {
  const serviceFor = (): EmployeeService => {
    const fs = deps.context.requireOpenCompany().fs
    let svc = services.get(fs)
    if (!svc) {
      const repo = deps.repository()
      svc = new EmployeeService({
        fs,
        exclusive: (task) => repo.runExclusive(task),
        isApproved: async (id) => {
          const d = await repo.getDecision(id)
          return d.ok && d.value.status === 'done' && d.value.chosen !== null
        },
        assignments: deps.assignments ?? NO_ASSIGNMENTS
      })
      services.set(fs, svc)
    }
    return svc
  }
  const call =
    <T>(fn: (svc: EmployeeService, req: unknown) => Promise<ApiResult<T>>) =>
    async (req: unknown): Promise<ApiResult<T>> => {
      try {
        return await fn(serviceFor(), req)
      } catch (e) {
        if (e instanceof NoCompanyError)
          return { ok: false, code: 'no-company', message: '열린 회사가 없습니다.' }
        return { ok: false, code: 'internal', message: '요청을 처리하지 못했습니다.' }
      }
    }
  return {
    listTemplates: async () => ({ ok: true, value: structuredClone([...EMPLOYEE_TEMPLATES]) }),
    createEmployee: call((s, r) => s.create(r, 'ceo-ui')),
    updateEmployee: call((s, r) => s.update(r, 'ceo-ui')),
    moveEmployee: call((s, r) => s.move(r, 'ceo-ui')),
    retireEmployee: call((s, r) => s.retire(r, 'ceo-ui')),
    // 입력이 없는 채널이라 renderer가 무엇을 보내도 무시한다.
    hirePm: () => call((s) => s.hirePm('ceo-ui'))(undefined),
    firstHire: call((s, r) => s.firstHire(r, 'ceo-ui'))
  }
}
