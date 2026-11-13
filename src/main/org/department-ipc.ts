import type { DepartmentChangeResult } from '../../shared/department'
import type { ApiResult } from '../../shared/result'
import { NoCompanyError, type CompanyContext } from '../company/company-context'
import type { FileCompanyRepository } from '../repository/file-repository'
import type { SafeFs } from '../repository/safe-fs'
import { DepartmentService } from './department-service'

export interface DepartmentIpcDeps {
  context: CompanyContext
  /** 직원 변경과 같은 쓰기 직렬화 큐를 쓰려고 같은 저장소 인스턴스를 받는다. */
  repository: () => FileCompanyRepository
}

export interface DepartmentHandlers {
  addDepartment: (req: unknown) => Promise<ApiResult<DepartmentChangeResult>>
  renameDepartment: (req: unknown) => Promise<ApiResult<DepartmentChangeResult>>
  removeDepartment: (req: unknown) => Promise<ApiResult<DepartmentChangeResult>>
}

const services = new WeakMap<SafeFs, DepartmentService>()

/** renderer 요청은 항상 `ceo-ui`로 처리한다. `actor`는 요청 필드가 아니고 `approved-proposal`은 main 코드(T-046)만 서비스로 쓴다. */
export function createDepartmentHandlers(deps: DepartmentIpcDeps): DepartmentHandlers {
  const serviceFor = (): DepartmentService => {
    const fs = deps.context.requireOpenCompany().fs
    let svc = services.get(fs)
    if (!svc) {
      const repo = deps.repository()
      svc = new DepartmentService({
        fs,
        exclusive: (task) => repo.runExclusive(task),
        isApproved: async (id) => {
          const d = await repo.getDecision(id)
          return d.ok && d.value.status === 'done' && d.value.chosen !== null
        }
      })
      services.set(fs, svc)
    }
    return svc
  }
  const call =
    (fn: (svc: DepartmentService, req: unknown) => Promise<ApiResult<DepartmentChangeResult>>) =>
    async (req: unknown): Promise<ApiResult<DepartmentChangeResult>> => {
      try {
        return await fn(serviceFor(), req)
      } catch (e) {
        if (e instanceof NoCompanyError)
          return { ok: false, code: 'no-company', message: '열린 회사가 없습니다.' }
        return { ok: false, code: 'internal', message: '요청을 처리하지 못했습니다.' }
      }
    }
  return {
    addDepartment: call((s, r) => s.add(r, 'ceo-ui')),
    renameDepartment: call((s, r) => s.rename(r, 'ceo-ui')),
    removeDepartment: call((s, r) => s.remove(r, 'ceo-ui'))
  }
}
