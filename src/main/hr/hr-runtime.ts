import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { CompanyContext } from '../company/company-context'
import { createFileGateCards } from '../gate/gate-cards'
import { createJsonStateStore } from '../gate/state-store'
import { integrityFor } from '../integrity/integrity-runtime'
import type { ProviderAdapter } from '../providers/types'
import type { SafeFs } from '../repository/safe-fs'
import { sharedRepository } from '../repository/shared-repository'
import { createHrRunner } from './hr-run'
import { ViolationStore } from './hr-violation'

export interface HrRuntimeDeps {
  context: CompanyContext
  /** 복원 정보는 회사 폴더가 아니라 userData에 둔다. */
  userDataDir: string
}

const stores = new WeakMap<SafeFs, ViolationStore>()

/** 열린 회사마다 하나. 결재함(복원 클릭)과 hr 실행이 같은 직렬 큐를 쓰게 한다. */
export function violationStoreFor(deps: HrRuntimeDeps): ViolationStore {
  const fs = deps.context.requireOpenCompany().fs
  const cached = stores.get(fs)
  if (cached) return cached
  const repo = sharedRepository(fs)
  const tag = createHash('sha256').update(fs.root).digest('hex').slice(0, 12)
  const store = new ViolationStore(
    createJsonStateStore(join(deps.userDataDir, `hr-scope-${tag}.json`)),
    fs,
    (t) => repo.runExclusive(t)
  )
  stores.set(fs, store)
  return store
}

/** 틱의 `hr` 연결점. 요청이 없으면 `pending`이 0이라 실행하지 않는다. */
export function hrRunnerFor(
  deps: HrRuntimeDeps & {
    createAdapter: (cwd: string) => ProviderAdapter
    readAgentPrompt: (id: string) => Promise<string | null>
  }
): ReturnType<typeof createHrRunner> {
  const fs = deps.context.requireOpenCompany().fs
  const repo = sharedRepository(fs)
  return createHrRunner({
    fs,
    integrity: integrityFor(deps),
    cards: createFileGateCards({ fs, exclusive: (t) => repo.runExclusive(t) }),
    violations: violationStoreFor(deps),
    createAdapter: deps.createAdapter,
    readAgentPrompt: deps.readAgentPrompt
  })
}
