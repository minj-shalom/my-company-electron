import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { CompanyContext } from '../company/company-context'
import { createFileGateCards } from '../gate/gate-cards'
import { createJsonStateStore } from '../gate/state-store'
import { sharedRepository } from '../repository/shared-repository'
import type { SafeFs } from '../repository/safe-fs'
import { HrAudit } from './hr-audit'
import { IntegrityStateStore } from './integrity-state'
import { IntegrityService } from './integrity-service'
import { filesWithSecrets } from './protected-files'
import { SnapshotStore } from './snapshot-store'

export interface IntegrityRuntimeDeps {
  context: CompanyContext
  /** 앱 userData. 스냅샷, 승인 레코드, 격리 상태는 회사 폴더가 아니라 여기에 둔다. */
  userDataDir: string
}

const services = new WeakMap<SafeFs, IntegrityService>()

/** 열린 회사마다 가드레일 하나. 저장 위치 이름에 회사 경로 해시를 넣어 회사 사이에 섞이지 않게 한다. */
export function integrityFor(deps: IntegrityRuntimeDeps): IntegrityService {
  const fs = deps.context.requireOpenCompany().fs
  const cached = services.get(fs)
  if (cached) return cached
  const repo = sharedRepository(fs)
  const exclusive = <T>(t: () => Promise<T>): Promise<T> => repo.runExclusive(t)
  const tag = createHash('sha256').update(fs.root).digest('hex').slice(0, 12)
  const svc = new IntegrityService({
    fs,
    exclusive,
    snapshots: new SnapshotStore(
      join(deps.userDataDir, 'snapshots', tag),
      () => new Date(),
      filesWithSecrets
    ),
    state: new IntegrityStateStore(
      createJsonStateStore(join(deps.userDataDir, `integrity-${tag}.json`))
    ),
    audit: new HrAudit({ fs, exclusive }),
    cards: createFileGateCards({ fs, exclusive })
  })
  services.set(fs, svc)
  return svc
}
