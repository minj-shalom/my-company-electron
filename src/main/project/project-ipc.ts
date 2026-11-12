import type { ApiResult } from '../../shared/result'
import {
  PROJECT_ID,
  type ProjectChangeResult,
  type ProjectList,
  type ProjectSelectFolderResult
} from '../../shared/project'
import { NoCompanyError, type CompanyContext } from '../company/company-context'
import { metaValue } from '../repository/markdown'
import { sharedRepository } from '../repository/shared-repository'
import type { SafeFs } from '../repository/safe-fs'
import { ProjectService, type InProgressSource } from './project-service'

export interface ProjectIpcDeps {
  context: CompanyContext
  homeDir?: string
}

export interface ProjectHandlers {
  /** `pick`은 main이 연 폴더 선택 다이얼로그다 (IPC 계층이 electron `dialog`를 감싸 넘긴다). */
  selectFolder: (
    pick: () => Promise<string | null>
  ) => Promise<ApiResult<ProjectSelectFolderResult>>
  list: () => Promise<ApiResult<ProjectList>>
  add: (req: unknown) => Promise<ApiResult<ProjectChangeResult>>
  rename: (req: unknown) => Promise<ApiResult<ProjectChangeResult>>
  archive: (req: unknown) => Promise<ApiResult<ProjectChangeResult>>
  restore: (req: unknown) => Promise<ApiResult<ProjectChangeResult>>
  setType: (req: unknown) => Promise<ApiResult<ProjectChangeResult>>
  setPm: (req: unknown) => Promise<ApiResult<ProjectChangeResult>>
  clearPm: (req: unknown) => Promise<ApiResult<ProjectChangeResult>>
}

/** 진행 중 티켓의 프로젝트 소속. 본문의 `- **프로젝트:** id` 줄만 읽는다 (T-042 전의 임시 규칙, 없으면 소속 불명). */
function inProgressSource(fs: SafeFs): InProgressSource {
  return {
    async list() {
      const { items, issues } = await sharedRepository(fs).listTickets('in-progress')
      return {
        tickets: items.map((t) => {
          const raw = metaValue(t.body, '프로젝트')?.replace(/^`|`$/g, '') ?? null
          return { project: raw !== null && PROJECT_ID.test(raw) ? raw : null }
        }),
        unreadable: issues.length
      }
    }
  }
}

const services = new WeakMap<SafeFs, ProjectService>()

export function createProjectHandlers(deps: ProjectIpcDeps): ProjectHandlers {
  // 폴더 선택 승인 목록을 호출 사이에 유지하려고 열린 회사(SafeFs)마다 서비스 하나를 쓴다.
  const serviceFor = (): ProjectService => {
    const fs = deps.context.requireOpenCompany().fs
    let svc = services.get(fs)
    if (!svc) {
      const repo = sharedRepository(fs)
      svc = new ProjectService({
        fs,
        exclusive: (task) => repo.runExclusive(task),
        inProgress: inProgressSource(fs),
        homeDir: deps.homeDir
      })
      services.set(fs, svc)
    }
    return svc
  }
  const call =
    <A extends unknown[], T>(fn: (svc: ProjectService, ...args: A) => Promise<ApiResult<T>>) =>
    async (...args: A): Promise<ApiResult<T>> => {
      try {
        return await fn(serviceFor(), ...args)
      } catch (e) {
        if (e instanceof NoCompanyError)
          return { ok: false, code: 'no-company', message: '열린 회사가 없습니다.' }
        return { ok: false, code: 'internal', message: '요청을 처리하지 못했습니다.' }
      }
    }
  return {
    selectFolder: call(async (s, pick: () => Promise<string | null>) => ({
      ok: true as const,
      value: await s.selectFolder(pick)
    })),
    list: call((s) => s.list()),
    add: call((s, r: unknown) => s.add(r)),
    rename: call((s, r: unknown) => s.rename(r)),
    archive: call((s, r: unknown) => s.archive(r)),
    restore: call((s, r: unknown) => s.restore(r)),
    setType: call((s, r: unknown) => s.setType(r)),
    setPm: call((s, r: unknown) => s.setPm(r)),
    clearPm: call((s, r: unknown) => s.clearPm(r))
  }
}
