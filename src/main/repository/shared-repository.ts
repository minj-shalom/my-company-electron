import { FileCompanyRepository } from './file-repository'
import type { SafeFs } from './safe-fs'

/** 열린 회사(SafeFs)마다 저장소 하나를 쓴다. 쓰기 직렬화 큐가 도메인(결정, 티켓, 직원, 프로젝트) 사이에 공유되어야 하기 때문이다. */
const repositories = new WeakMap<SafeFs, FileCompanyRepository>()

export function sharedRepository(fs: SafeFs): FileCompanyRepository {
  let repo = repositories.get(fs)
  if (!repo) {
    repo = FileCompanyRepository.fromSafeFs(fs)
    repositories.set(fs, repo)
  }
  return repo
}
