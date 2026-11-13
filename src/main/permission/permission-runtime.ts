import type { CompanyContext } from '../company/company-context'
import { createFileGateCards } from '../gate/gate-cards'
import { sharedRepository } from '../repository/shared-repository'
import { createPermissionStore } from './permission-store'
import { PermissionService } from './permission-service'

export interface PermissionRuntimeDeps {
  context: CompanyContext
  userDataDir: string
}

/** 열린 회사에 묶인 권한 서비스. 요청 기록은 앱 userData에만 둔다. */
export function permissionServiceFor(deps: PermissionRuntimeDeps): PermissionService {
  const { fs } = deps.context.requireOpenCompany()
  const repo = sharedRepository(fs)
  const exclusive = <T>(t: () => Promise<T>): Promise<T> => repo.runExclusive(t)
  return new PermissionService({
    fs,
    exclusive,
    cards: createFileGateCards({ fs, exclusive }),
    store: createPermissionStore(deps.userDataDir)
  })
}
