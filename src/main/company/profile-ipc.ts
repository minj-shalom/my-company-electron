import type { ApiResult } from '../../shared/result'
import type { CompanyProfile } from '../../shared/company-profile'
import { NoCompanyError, type CompanyContext } from './company-context'
import { sharedRepository } from '../repository/shared-repository'
import type { SafeFs } from '../repository/safe-fs'
import { ProfileService } from './profile-service'

export interface ProfileHandlers {
  getCompanyProfile: () => Promise<ApiResult<CompanyProfile>>
  saveCompanyProfile: (req: unknown) => Promise<ApiResult<CompanyProfile>>
}

const services = new WeakMap<SafeFs, ProfileService>()

function serviceFor(context: CompanyContext): ProfileService {
  const fs = context.requireOpenCompany().fs
  let svc = services.get(fs)
  if (!svc) {
    const repo = sharedRepository(fs)
    svc = new ProfileService({ fs, exclusive: (task) => repo.runExclusive(task) })
    services.set(fs, svc)
  }
  return svc
}

export function createProfileHandlers(deps: { context: CompanyContext }): ProfileHandlers {
  const call =
    <A extends unknown[]>(
      fn: (svc: ProfileService, ...args: A) => Promise<ApiResult<CompanyProfile>>
    ) =>
    async (...args: A): Promise<ApiResult<CompanyProfile>> => {
      try {
        return await fn(serviceFor(deps.context), ...args)
      } catch (e) {
        if (e instanceof NoCompanyError)
          return { ok: false, code: 'no-company', message: '열린 회사가 없습니다.' }
        return { ok: false, code: 'internal', message: '요청을 처리하지 못했습니다.' }
      }
    }
  return {
    getCompanyProfile: call((s) => s.get()),
    saveCompanyProfile: call((s, r: unknown) => s.save(r))
  }
}
