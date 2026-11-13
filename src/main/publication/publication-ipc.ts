import { realpath } from 'node:fs/promises'
import type { ApiResult } from '../../shared/result'
import type {
  PublicationDraftContent,
  PublicationEntry,
  PublicationList,
  PublicationProgress,
  PublicationPublishResult,
  PublicationRequestApprovalResult
} from '../../shared/publication'
import { PROJECT_ID } from '../../shared/project'
import { NoCompanyError, type CompanyContext } from '../company/company-context'
import { createFileGateCards } from '../gate/gate-cards'
import type { Publisher } from '../gate/publisher'
import { policyServiceFor } from '../policy/policy-ipc'
import { projectServiceFor } from '../project/project-ipc'
import type { DayClock } from '../recurring/recurring-schedule'
import { sharedRepository } from '../repository/shared-repository'
import type { SafeFs } from '../repository/safe-fs'
import { PublicationService } from './publication-service'

export interface PublicationIpcDeps {
  context: CompanyContext
  homeDir?: string
  /** 발행 어댑터(T-054가 채운다). 없으면 `manual`만 동작한다. */
  publishers?: ReadonlyMap<string, Publisher>
  clock?: DayClock
}

export interface PublicationHandlers {
  listPublications: (req: unknown) => Promise<ApiResult<PublicationList>>
  scanPublications: (req: unknown) => Promise<ApiResult<PublicationList>>
  readPublicationDraft: (req: unknown) => Promise<ApiResult<PublicationDraftContent>>
  requestPublicationApproval: (req: unknown) => Promise<ApiResult<PublicationRequestApprovalResult>>
  requestPublish: (req: unknown) => Promise<ApiResult<PublicationEntry>>
  publishPublication: (req: unknown) => Promise<ApiResult<PublicationPublishResult>>
  markPublished: (req: unknown) => Promise<ApiResult<PublicationPublishResult>>
  getPublicationProgress: (req: unknown) => Promise<ApiResult<PublicationProgress>>
}

const services = new WeakMap<SafeFs, PublicationService>()

/** 열린 회사(SafeFs)마다 서비스 하나. 결정 처리 경로(`onCardResolved`)와 T-053 게이트(`recordAutoApproval`)도 같은 서비스를 쓴다. */
export function publicationServiceFor(deps: PublicationIpcDeps): PublicationService {
  const fs = deps.context.requireOpenCompany().fs
  const cached = services.get(fs)
  if (cached) return cached
  const repo = sharedRepository(fs)
  const exclusive = <T>(t: () => Promise<T>): Promise<T> => repo.runExclusive(t)
  const policies = policyServiceFor({ context: deps.context })
  const projects = projectServiceFor({ context: deps.context, homeDir: deps.homeDir })
  const svc = new PublicationService({
    fs,
    exclusive,
    project: async (projectId) => {
      if (!PROJECT_ID.test(projectId)) return null
      const list = await projects.list()
      if (!list.ok) return null
      const p = list.value.items.find((x) => x.id === projectId)
      if (p === undefined) return null
      const dir = await realpath(p.path).catch(() => null)
      return dir === null ? null : { dir, archived: p.status === 'archived' }
    },
    policy: async (projectId) => {
      const r = await policies.get({ projectId })
      return r.ok ? r.value : null
    },
    cards: createFileGateCards({ fs, exclusive }),
    publishers: deps.publishers,
    clock: deps.clock ?? { now: () => new Date() }
  })
  services.set(fs, svc)
  return svc
}

export function createPublicationHandlers(deps: PublicationIpcDeps): PublicationHandlers {
  const call =
    <T>(fn: (svc: PublicationService, req: unknown) => Promise<ApiResult<T>>) =>
    async (req: unknown): Promise<ApiResult<T>> => {
      try {
        return await fn(publicationServiceFor(deps), req)
      } catch (e) {
        if (e instanceof NoCompanyError)
          return { ok: false, code: 'no-company', message: '열린 회사가 없습니다.' }
        return { ok: false, code: 'internal', message: '요청을 처리하지 못했습니다.' }
      }
    }
  return {
    listPublications: call((s, r) => s.list(r)),
    scanPublications: call((s, r) => s.scan(r)),
    readPublicationDraft: call((s, r) => s.readDraftContent(r)),
    requestPublicationApproval: call((s, r) => s.requestApproval(r)),
    requestPublish: call((s, r) => s.requestPublish(r)),
    publishPublication: call((s, r) => s.publish(r)),
    markPublished: call((s, r) => s.markPublished(r)),
    getPublicationProgress: call((s, r) => s.progress(r))
  }
}
