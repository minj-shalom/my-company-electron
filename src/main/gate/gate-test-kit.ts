import { rm } from 'node:fs/promises'
import { makeCompany, type TestCompany } from '../employee/test-company'
import type { PolicyState } from '../../shared/policy'
import type { ProjectState } from '../../shared/project'
import { AuditLog } from './audit-log'
import type { CommandRunner } from './command-runner'
import { createFileGateCards } from './gate-cards'
import { GateService } from './gate-service'
import type { GateContext, Planner } from './gate-types'
import { KillSwitch } from './kill-switch'
import { GateLedger } from './ledger'
import { createPlanMerge, planPush } from './plan-git'
import { createMemoryStateStore } from './state-store'

export const SHA = 'a'.repeat(40)

export interface RunnerCall {
  command: string
  args: readonly string[]
}

export type Responder = (
  command: string,
  args: readonly string[],
  signal?: AbortSignal
) => Promise<{ code: number | null; stdout: string }> | { code: number | null; stdout: string }

/** 실제 git/gh를 실행하지 않는 가짜 실행기. 호출을 기록한다. */
export function fakeRunner(respond: Responder): { runner: CommandRunner; calls: RunnerCall[] } {
  const calls: RunnerCall[] = []
  return {
    calls,
    runner: {
      run: async (command, args, opts) => {
        calls.push({ command, args })
        return respond(command, args, opts.signal)
      }
    }
  }
}

export const isPush = (c: RunnerCall): boolean => c.command === 'git' && c.args.includes('push')

/** 기본 응답: HEAD=feature/x, 모든 브랜치 해시 SHA, 푸시·머지 성공. */
export const okResponder =
  (over: Responder = () => ({ code: -1, stdout: '' })): Responder =>
  async (command, args, signal) => {
    const o = await over(command, args, signal)
    if (o.code !== -1) return o
    if (args.includes('symbolic-ref')) return { code: 0, stdout: 'refs/heads/feature/x\n' }
    if (args.includes('rev-parse')) return { code: 0, stdout: `${SHA}\n` }
    if (command === 'gh' && args[1] === 'view')
      return {
        code: 0,
        stdout: JSON.stringify({
          baseRefName: 'develop',
          headRefName: 'feature/T-053',
          headRefOid: SHA,
          state: 'OPEN',
          isDraft: false
        })
      }
    return { code: 0, stdout: '' }
  }

export function policyState(over: {
  push?: 'every' | 'batch' | 'auto'
  merge?: 'every' | 'batch' | 'auto'
  limits?: Partial<Record<'push' | 'merge' | 'publish', number>>
  prefixes?: string[]
  mergeBranches?: string[]
  protectedMerge?: boolean
  activated?: boolean
  usePr?: boolean
  review?: 'required' | 'recommended'
}): PolicyState {
  const modes = {
    push: over.push ?? 'auto',
    merge: over.merge ?? 'every',
    publish: 'every',
    'draft-approve': 'every'
  } as PolicyState['effective']['modes']
  return {
    projectId: 'my-company',
    exists: true,
    revision: 'r',
    values: {} as PolicyState['values'],
    effective: {
      flow: 'dev-git-pr',
      modes,
      dailyLimits: over.limits ?? { push: 3, merge: 2 },
      autoPushPrefixes: over.prefixes ?? ['feature/'],
      autoMergeBranches: over.mergeBranches ?? ['develop'],
      protectedMergeEnabled: over.protectedMerge ?? false,
      usePr: over.usePr ?? true,
      reviewStage: over.review ?? 'required'
    },
    activation: over.activated === false ? null : { at: '2026-11-01T00:00:00.000Z', by: 'ceo-ui' },
    warnings: [],
    history: []
  }
}

export interface Kit {
  c: TestCompany
  svc: GateService
  killSwitch: KillSwitch
  ledger: GateLedger
  audit: AuditLog
  calls: RunnerCall[]
  clock: { now: Date }
  policy: { value: PolicyState | null }
  project: { state: ProjectState }
  reviewPassed: { value: boolean }
  history: string[]
  ctx: GateContext
  cleanup: () => Promise<void>
}

export async function makeKit(
  opts: { responder?: Responder; planners?: Record<string, Planner>; timeZone?: string } = {}
): Promise<Kit> {
  const c = await makeCompany()
  const exclusive = <T>(t: () => Promise<T>): Promise<T> => c.repo.runExclusive(t)
  const clock = { now: new Date('2026-11-13T03:00:00.000Z') }
  const now = (): Date => clock.now
  const { runner, calls } = fakeRunner(opts.responder ?? okResponder())
  const history: string[] = []
  const killSwitch = new KillSwitch({
    store: createMemoryStateStore(),
    now,
    recordHistory: async (_p, s) => {
      history.push(s)
    }
  })
  const ledger = new GateLedger(createMemoryStateStore(), opts.timeZone ?? 'Asia/Seoul')
  const audit = new AuditLog({ fs: c.fs, exclusive })
  const policy = { value: policyState({}) as PolicyState | null }
  const project = { state: 'ready' as ProjectState }
  const reviewPassed = { value: true }
  const svc = new GateService({
    policy: async () => policy.value,
    projects: { resolve: async () => ({ dir: '/proj', state: project.state }) },
    runner,
    ledger,
    killSwitch,
    audit,
    cards: createFileGateCards({ fs: c.fs, exclusive, now }),
    planners: {
      push: planPush,
      merge: createPlanMerge({ passed: async () => reviewPassed.value }),
      ...opts.planners
    },
    now
  })
  return {
    c,
    svc,
    killSwitch,
    ledger,
    audit,
    calls,
    clock,
    policy,
    project,
    reviewPassed,
    history,
    ctx: { projectId: 'my-company', employeeId: 'developer', ticketId: 'T-053', autoAllowed: true },
    cleanup: () => rm(c.dir, { recursive: true, force: true })
  }
}
