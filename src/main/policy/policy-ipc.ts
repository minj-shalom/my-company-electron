import type { ApiResult } from '../../shared/result'
import type { PolicySaveResult, PolicyState, PolicySummary } from '../../shared/policy'
import { NoCompanyError, type CompanyContext } from '../company/company-context'
import { sharedRepository } from '../repository/shared-repository'
import type { SafeFs } from '../repository/safe-fs'
import { PolicyService } from './policy-service'

export interface PolicyIpcDeps {
  context: CompanyContext
}

export interface PolicyHandlers {
  getPolicy: (req: unknown) => Promise<ApiResult<PolicyState>>
  savePolicy: (req: unknown) => Promise<ApiResult<PolicySaveResult>>
  listPolicySummaries: () => Promise<ApiResult<PolicySummary[]>>
}

const services = new WeakMap<SafeFs, PolicyService>()

/** 열린 회사(SafeFs)마다 서비스 하나. T-046 제안 적용과 T-053 게이트도 같은 서비스를 쓴다. */
export function policyServiceFor(deps: PolicyIpcDeps): PolicyService {
  const fs = deps.context.requireOpenCompany().fs
  let svc = services.get(fs)
  if (!svc) {
    const repo = sharedRepository(fs)
    svc = new PolicyService({ fs, exclusive: (task) => repo.runExclusive(task) })
    services.set(fs, svc)
  }
  return svc
}

export function createPolicyHandlers(deps: PolicyIpcDeps): PolicyHandlers {
  const call =
    <A extends unknown[], T>(fn: (svc: PolicyService, ...args: A) => Promise<ApiResult<T>>) =>
    async (...args: A): Promise<ApiResult<T>> => {
      try {
        return await fn(policyServiceFor(deps), ...args)
      } catch (e) {
        if (e instanceof NoCompanyError)
          return { ok: false, code: 'no-company', message: '열린 회사가 없습니다.' }
        return { ok: false, code: 'internal', message: '요청을 처리하지 못했습니다.' }
      }
    }
  return {
    getPolicy: call((s, r: unknown) => s.get(r)),
    savePolicy: call((s, r: unknown) => s.save(r)),
    listPolicySummaries: call((s) => s.listSummaries())
  }
}
