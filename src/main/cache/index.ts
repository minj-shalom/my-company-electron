import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { FileCompanyRepository } from '../repository/file-repository'
import { SafeFs } from '../repository/safe-fs'
import type { CompanyRepository } from '../repository/repository'
import { CacheStore } from './cache-store'
import { CachedCompanyRepository } from './cached-repository'
import { CompanyWatcher } from './company-watcher'

export { CachedCompanyRepository } from './cached-repository'
export { CacheStore } from './cache-store'
export { CompanyWatcher } from './company-watcher'

/**
 * 캐시 DB 위치: 앱 데이터 폴더 아래, 회사 폴더 경로의 해시로 파일 하나.
 * 회사 폴더 안에 두지 않는 이유는 (1) 폴더가 git/클라우드 동기화 대상이라 바이너리가 섞이지 않고
 * (2) CLI 에이전트가 건드릴 수 없으며 (3) 폴더는 마크다운만 담는다는 원칙을 지키기 위해서다.
 * 파일 이름에 폴더 이름이나 내용을 쓰지 않으므로 경로 조합 입력이 없다.
 */
export function cacheDbPath(userDataDir: string, companyRoot: string): string {
  const key = createHash('sha256').update(companyRoot).digest('hex').slice(0, 16)
  return join(userDataDir, 'cache', `${key}.sqlite`)
}

export interface CachedCompany {
  repository: CompanyRepository
  /** 캐시를 버리고 폴더에서 다시 만든다. */
  rebuild(): Promise<void>
  close(): Promise<void>
}

export interface OpenCachedCompanyOptions {
  companyDir: string
  dbPath: string
  /** 감시를 켠다 (기본 true). */
  watch?: boolean
  debounceMs?: number
  onWatchError?: (e: unknown) => void
}

/**
 * 파일 Repository 위에 캐시를 얹어 연다. 시작할 때 항상 한 번 rebuild한다:
 * 앱이 꺼진 동안의 외부 수정과 DB 손상/삭제를 같은 경로로 복구하며, 회사 폴더는 작아 비용이 낮다.
 */
export async function openCachedCompany(opts: OpenCachedCompanyOptions): Promise<CachedCompany> {
  const fs = await SafeFs.open(opts.companyDir)
  const source = await FileCompanyRepository.open(opts.companyDir)
  const store = CacheStore.open(opts.dbPath)
  const repository = new CachedCompanyRepository(source, store)
  let watcher: CompanyWatcher | null = null
  try {
    if (opts.watch !== false) {
      watcher = new CompanyWatcher({
        root: fs.root,
        onChange: (kinds) => repository.refresh(kinds),
        onError: opts.onWatchError,
        debounceMs: opts.debounceMs
      })
      // 감시를 먼저 켜고 rebuild해야 그 사이의 변경을 놓치지 않는다.
      await watcher.start()
    }
    await repository.rebuild()
  } catch (e) {
    await watcher?.stop()
    await repository.drain().catch(() => undefined)
    store.close()
    throw e
  }
  return {
    repository,
    rebuild: () => repository.rebuild(),
    async close() {
      await watcher?.stop()
      // 진행 중인 갱신이 닫힌 DB를 건드리지 않도록 큐를 비운 뒤 닫는다.
      await repository.drain().catch(() => undefined)
      store.close()
    }
  }
}
