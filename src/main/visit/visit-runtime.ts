import { createHash } from 'node:crypto'
import type { CompanyContext } from '../company/company-context'
import { gateRuntimeFor } from '../gate/gate-runtime'
import type { SafeFs } from '../repository/safe-fs'
import { VisitService } from './visit-service'
import { createVisitStore, type VisitStore } from './visit-store'

export interface VisitRuntimeDeps {
  context: CompanyContext
  userDataDir: string
  homeDir?: string
}

const stores = new Map<string, VisitStore>()
const services = new WeakMap<SafeFs, VisitService>()

export function visitStoreFor(userDataDir: string): VisitStore {
  let s = stores.get(userDataDir)
  if (!s) {
    s = createVisitStore(userDataDir)
    stores.set(userDataDir, s)
  }
  return s
}

/** 열린 회사마다 서비스 하나. 열린 회사가 없으면 NoCompanyError. */
export function visitServiceFor(deps: VisitRuntimeDeps): VisitService {
  const fs = deps.context.requireOpenCompany().fs
  let svc = services.get(fs)
  if (!svc) {
    const gate = (): ReturnType<typeof gateRuntimeFor> =>
      gateRuntimeFor({
        context: deps.context,
        userDataDir: deps.userDataDir,
        homeDir: deps.homeDir
      })
    svc = new VisitService({
      fs,
      companyTag: createHash('sha256').update(fs.root).digest('hex').slice(0, 12),
      store: visitStoreFor(deps.userDataDir),
      audit: (from, to) => gate().audit.summary(from, to),
      killSwitch: () => gate().killSwitch.get()
    })
    services.set(fs, svc)
  }
  return svc
}
