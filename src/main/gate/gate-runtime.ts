import { createHash } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { join } from 'node:path'
import type { ApiResult } from '../../shared/result'
import type { AuditSummary, KillSwitchState } from '../../shared/gate'
import type { PolicyState } from '../../shared/policy'
import { PROJECT_ID } from '../../shared/project'
import type { CompanyContext } from '../company/company-context'
import { policyServiceFor } from '../policy/policy-ipc'
import { projectServiceFor } from '../project/project-ipc'
import { sharedRepository } from '../repository/shared-repository'
import type { SafeFs } from '../repository/safe-fs'
import { AuditLog } from './audit-log'
import { createCommandRunner, type CommandRunner } from './command-runner'
import { createFileGateCards } from './gate-cards'
import { GateService } from './gate-service'
import type { Planner, ProjectRuntime } from './gate-types'
import { KillSwitch } from './kill-switch'
import { GateLedger } from './ledger'
import { createPlanMerge, planPush } from './plan-git'
import { createReportReviewChecker } from './review-checker'
import { createJsonStateStore } from './state-store'

export interface GateRuntimeDeps {
  context: CompanyContext
  /** 앱 userData. 킬 스위치와 일일 카운트는 회사 폴더가 아니라 여기에 둔다 (에이전트가 쓸 수 없다). */
  userDataDir: string
  homeDir?: string
  runner?: CommandRunner
  /** 추가 계획기(T-054 발행 등). 기본은 푸시·머지만. */
  extraPlanners?: (fs: SafeFs) => Partial<Record<'publish', Planner>>
  timeZone?: string
}

export interface GateRuntime {
  service: GateService
  killSwitch: KillSwitch
  audit: AuditLog
}

const runtimes = new WeakMap<SafeFs, GateRuntime>()

/** 열린 회사마다 게이트 하나. 상태 파일 이름에 회사 경로 해시를 넣어 회사 사이에 카운트가 섞이지 않게 한다. */
export function gateRuntimeFor(deps: GateRuntimeDeps): GateRuntime {
  const fs = deps.context.requireOpenCompany().fs
  const cached = runtimes.get(fs)
  if (cached) return cached
  const repo = sharedRepository(fs)
  const exclusive = <T>(t: () => Promise<T>): Promise<T> => repo.runExclusive(t)
  const tag = createHash('sha256').update(fs.root).digest('hex').slice(0, 12)
  const policyDeps = { context: deps.context }
  const policies = (): ReturnType<typeof policyServiceFor> => policyServiceFor(policyDeps)
  const killSwitch = new KillSwitch({
    store: createJsonStateStore(join(deps.userDataDir, `gate-kill-switch-${tag}.json`)),
    recordHistory: async (projectId, summary) => {
      if (projectId !== null) return policies().appendHistory(projectId, summary)
      const list = await projectServiceFor(policyDeps).list()
      if (!list.ok) return
      for (const p of list.value.items)
        await policies()
          .appendHistory(p.id, summary)
          .catch(() => undefined)
    }
  })
  const audit = new AuditLog({ fs, exclusive })
  const ledger = new GateLedger(
    createJsonStateStore(join(deps.userDataDir, `gate-ledger-${tag}.json`)),
    deps.timeZone
  )
  const projects = {
    async resolve(projectId: string): Promise<ProjectRuntime | null> {
      if (!PROJECT_ID.test(projectId)) return null
      const list = await projectServiceFor({ ...policyDeps, homeDir: deps.homeDir }).list()
      if (!list.ok) return null
      const p = list.value.items.find((x) => x.id === projectId)
      if (p === undefined) return null
      const dir = await realpath(p.path).catch(() => null)
      return dir === null ? null : { dir, state: p.state }
    }
  }
  const service = new GateService({
    policy: async (projectId): Promise<PolicyState | null> => {
      const r: ApiResult<PolicyState> = await policies().get({ projectId })
      return r.ok ? r.value : null
    },
    projects,
    runner: deps.runner ?? createCommandRunner(),
    ledger,
    killSwitch,
    audit,
    cards: createFileGateCards({ fs, exclusive }),
    planners: {
      push: planPush,
      merge: createPlanMerge(createReportReviewChecker(fs)),
      ...deps.extraPlanners?.(fs)
    }
  })
  const rt: GateRuntime = { service, killSwitch, audit }
  runtimes.set(fs, rt)
  return rt
}

export type { AuditSummary, KillSwitchState }
