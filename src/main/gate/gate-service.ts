import { createHash } from 'node:crypto'
import { EMPLOYEE_ID, TICKET_ID } from '../repository/ids'
import {
  GATE_ACTION_OF_TOOL,
  GATE_TOOL_NAMES,
  type AuditResult,
  type GateResult,
  type GateToolName
} from '../../shared/gate'
import { MAX_DAILY_LIMIT, type LimitedAction, type PolicyState } from '../../shared/policy'
import { PROJECT_ID } from '../../shared/project'
import type { AuditEntry, AuditLog } from './audit-log'
import type { CommandRunner } from './command-runner'
import type { GateCards } from './gate-cards'
import type { GateContext, GatePlan, Planner, ProjectRuntime } from './gate-types'
import type { KillSwitch } from './kill-switch'
import type { GateLedger } from './ledger'

export interface GateServiceDeps {
  policy: (projectId: string) => Promise<PolicyState | null>
  projects: { resolve(projectId: string): Promise<ProjectRuntime | null> }
  runner: CommandRunner
  ledger: GateLedger
  killSwitch: KillSwitch
  audit: AuditLog
  cards: GateCards
  planners: Partial<Record<LimitedAction, Planner>>
  now?: () => Date
}

const CARD_KIND: Record<LimitedAction, 'git-confirm' | 'content-approval'> = {
  push: 'git-confirm',
  merge: 'git-confirm',
  publish: 'content-approval'
}
const ACTION_LABEL: Record<LimitedAction, string> = { push: '푸시', merge: '머지', publish: '발행' }

/**
 * 푸시·머지·발행 게이트(T-053). 에이전트는 raw 명령이 아니라 이 게이트로만 실행을 요청한다.
 * 정책이 `매번/묶음 컨펌`이거나 자동 조건이 하나라도 어긋나면 실행하지 않고 결정 카드를 남긴다 (보수적 대체).
 * 자동 실행은 허용 대상, 일일 상한, 킬 스위치, 멱등 키를 모두 통과해야 하고 실패해도 재시도하지 않는다.
 */
export class GateService {
  private readonly inflight = new Set<{ projectId: string; abort: AbortController }>()
  private readonly chains = new Map<string, Promise<unknown>>()

  constructor(private readonly deps: GateServiceDeps) {
    // 킬 스위치를 켜면 진행 중인 게이트 작업을 취소 가능한 시점에서 멈춘다.
    deps.killSwitch.onEngage(({ projectId }) => {
      for (const f of this.inflight)
        if (projectId === null || f.projectId === projectId) f.abort.abort()
    })
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date()
  }

  /** 프로젝트별로 한 줄로 세운다 (상한 검사·멱등 키·실행이 겹치지 않게). */
  private serial<T>(projectId: string, task: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(projectId) ?? Promise.resolve()
    const run = prev.then(task, task)
    const tail = run.catch(() => undefined)
    this.chains.set(projectId, tail)
    void tail.then(() => {
      if (this.chains.get(projectId) === tail) this.chains.delete(projectId)
    })
    return run
  }

  call(ctx: GateContext, tool: string, raw: unknown): Promise<GateResult> {
    if (
      !GATE_TOOL_NAMES.includes(tool as GateToolName) ||
      !PROJECT_ID.test(ctx.projectId) ||
      !EMPLOYEE_ID.test(ctx.employeeId) ||
      (ctx.ticketId !== null && !TICKET_ID.test(ctx.ticketId))
    )
      return Promise.resolve({ status: 'blocked', message: '허용되지 않는 요청입니다.' })
    const action = GATE_ACTION_OF_TOOL[tool as GateToolName]
    return this.serial(ctx.projectId, () =>
      this.handle(ctx, action, raw).catch((): GateResult => ({
        status: 'failed',
        message: '게이트 처리 중 오류가 났습니다. 재시도하지 않습니다.'
      }))
    )
  }

  private async handle(ctx: GateContext, action: LimitedAction, raw: unknown): Promise<GateResult> {
    const { deps } = this
    const planner = deps.planners[action]
    const project = await deps.projects.resolve(ctx.projectId)
    if (planner === undefined || project === null)
      return { status: 'blocked', message: `${ACTION_LABEL[action]} 게이트를 쓸 수 없습니다.` }
    // 정책을 읽지 못하면 보수적으로 `매번 컨펌`이다 (기본 정책과 같다).
    const policy = await deps.policy(ctx.projectId)

    const flight = { projectId: ctx.projectId, abort: new AbortController() }
    this.inflight.add(flight)
    try {
      if (policy === null) return await this.confirmOnly(ctx, action, raw, 'policy')
      const out = await planner(
        { ctx, project, policy, runner: deps.runner, signal: flight.abort.signal },
        raw
      )
      if (out.kind === 'reject') return { status: 'blocked', message: out.message }
      return await this.decide(ctx, policy, project, out.plan, flight)
    } finally {
      this.inflight.delete(flight)
    }
  }

  /** 정책이 없을 때: 대상 확인 없이 일반 카드만 남긴다. */
  private async confirmOnly(
    ctx: GateContext,
    action: LimitedAction,
    raw: unknown,
    why: string
  ): Promise<GateResult> {
    const key = `policy|${createHash('sha256')
      .update(`${ctx.projectId}|${action}|${JSON.stringify(raw) ?? ''}`)
      .digest('hex')}`
    const existing = await this.deps.ledger.cardFor(key)
    if (existing !== null)
      return {
        status: 'card',
        cardId: existing,
        message: `컨펌 카드 ${existing}가 이미 있습니다. 실행하지 않았습니다.`
      }
    const id = await this.deps.cards.create({
      kind: CARD_KIND[action],
      title: `${ACTION_LABEL[action]} 컨펌 요청 (${ctx.projectId})`,
      ticketId: ctx.ticketId,
      question: `${ctx.employeeId}가 ${ACTION_LABEL[action]}을 요청했지만 정책을 읽지 못해(${why}) 실행하지 않았습니다. 허용할까요?`,
      options: [
        { key: 'A', label: '승인', description: '사람이 확인 후 실행합니다.' },
        { key: 'B', label: '거부', description: '실행하지 않습니다.' }
      ],
      impact: `${ACTION_LABEL[action]}은 컨펌 전까지 실행되지 않습니다.`
    })
    await this.deps.ledger.setCard(key, id)
    return {
      status: 'card',
      cardId: id,
      message: `컨펌 카드 ${id}를 남겼습니다. 실행하지 않았습니다.`
    }
  }

  private async record(
    ctx: GateContext,
    plan: GatePlan,
    result: AuditResult,
    mode: 'auto' | 'fallback',
    count: string | null
  ): Promise<boolean> {
    const entry: AuditEntry = {
      at: this.now(),
      action: plan.action,
      target: plan.target,
      result,
      employee: ctx.employeeId,
      ticket: ctx.ticketId,
      mode,
      count
    }
    try {
      await this.deps.audit.append(ctx.projectId, entry)
      return true
    } catch {
      return false
    }
  }

  private async card(
    ctx: GateContext,
    plan: GatePlan,
    reason: string,
    kind: 'confirm' | 'failure' | 'limit'
  ): Promise<string> {
    const key = `${kind}|${plan.idemKey}`
    const existing = await this.deps.ledger.cardFor(key)
    if (existing !== null) return existing
    const label = ACTION_LABEL[plan.action]
    const title =
      kind === 'confirm'
        ? `${label} 컨펌: ${plan.target}`
        : kind === 'limit'
          ? `${label} 일일 상한 도달 (${ctx.projectId})`
          : `${label} 자동 실행 실패: ${plan.target}`
    const id = await this.deps.cards.create({
      kind: kind === 'confirm' ? CARD_KIND[plan.action] : 'decision',
      title,
      ticketId: ctx.ticketId,
      question: `${ctx.employeeId}의 ${label} 요청(${plan.target})을 실행하지 않았습니다. 사유: ${reason}`,
      options:
        kind === 'confirm'
          ? [
              { key: 'A', label: '승인', description: '사람이 확인 후 실행합니다.' },
              { key: 'B', label: '거부', description: '실행하지 않습니다.' }
            ]
          : [{ key: 'A', label: '확인', description: '내용을 확인했습니다.' }],
      impact:
        kind === 'failure'
          ? '재시도하지 않았습니다. 원인을 확인한 뒤 다시 요청해야 합니다.'
          : `${label}은 실행되지 않았습니다.`
    })
    await this.deps.ledger.setCard(key, id)
    return id
  }

  private async decide(
    ctx: GateContext,
    policy: PolicyState,
    project: ProjectRuntime,
    plan: GatePlan,
    flight: { abort: AbortController }
  ): Promise<GateResult> {
    const { deps } = this
    const { effective } = policy
    const mode = effective.modes[plan.action]
    const policyLimit = effective.dailyLimits[plan.action]

    let fallback: { result: AuditResult; reason: string } | null = null
    if (mode !== 'auto') fallback = null
    else if (await deps.killSwitch.isEngaged(ctx.projectId))
      fallback = { result: 'blocked-killswitch', reason: '킬 스위치가 켜져 있습니다.' }
    else if (!ctx.autoAllowed)
      fallback = { result: 'fallback-card', reason: '이 실행은 자동 모드를 쓸 수 없습니다.' }
    else if (project.state !== 'ready')
      fallback = { result: 'fallback-card', reason: '프로젝트 담당 PM이 필요합니다.' }
    else if (policy.activation === null || policyLimit === undefined)
      fallback = { result: 'fallback-card', reason: '자동 모드 설정이 유효하지 않습니다.' }
    else if (plan.fallback !== null) fallback = plan.fallback
    else if (!(await deps.audit.canWrite(ctx.projectId)))
      fallback = { result: 'fallback-card', reason: '감사 기록을 쓸 수 없습니다.' }

    if (mode !== 'auto' || fallback !== null) {
      const id = await this.card(
        ctx,
        plan,
        fallback?.reason ?? '컨펌이 필요한 모드입니다.',
        'confirm'
      )
      if (mode === 'auto' && fallback !== null)
        await this.record(ctx, plan, fallback.result, 'fallback', null)
      return {
        status: 'card',
        cardId: id,
        message: `실행하지 않고 컨펌 카드 ${id}를 남겼습니다. (${fallback?.reason ?? '컨펌 모드'})`
      }
    }

    const st = await deps.ledger.keyStatus(plan.idemKey)
    if (st === 'executed') {
      await this.record(ctx, plan, 'duplicate', 'auto', null)
      return {
        status: 'duplicate',
        message: '이미 같은 내용을 실행했습니다. 다시 실행하지 않았습니다.'
      }
    }
    if (st !== null)
      return {
        status: 'blocked',
        message:
          '같은 요청의 이전 시도가 실패했거나 진행 중입니다. 재시도하지 않습니다. 카드를 확인하세요.'
      }

    const limit = Math.min(
      policyLimit as number,
      MAX_DAILY_LIMIT[plan.action],
      plan.extraCap ?? Infinity
    )
    if (!(await deps.ledger.begin(plan.idemKey, plan.action, this.now())))
      return { status: 'duplicate', message: '같은 요청이 처리 중입니다.' }
    const n = await deps.ledger.reserve(ctx.projectId, plan.action, limit, this.now())
    if (n === null) {
      await deps.ledger.release(plan.idemKey)
      await this.record(ctx, plan, 'blocked-limit', 'auto', `${limit}/${limit}`)
      const id = await this.card(
        ctx,
        plan,
        `오늘 ${ACTION_LABEL[plan.action]} 상한(${limit}회)에 도달했습니다.`,
        'limit'
      )
      return {
        status: 'blocked',
        cardId: id,
        message: `오늘 ${ACTION_LABEL[plan.action]} 상한에 도달해 실행하지 않았습니다. 카드 ${id}를 남겼습니다.`
      }
    }
    const count = `${n}/${limit}`
    // 킬 스위치는 카운트를 올린 뒤에도 실행 직전에 다시 본다.
    if (await deps.killSwitch.isEngaged(ctx.projectId)) {
      await deps.ledger.release(plan.idemKey)
      await this.record(ctx, plan, 'blocked-killswitch', 'fallback', count)
      const id = await this.card(ctx, plan, '킬 스위치가 켜져 있습니다.', 'confirm')
      return {
        status: 'card',
        cardId: id,
        message: `킬 스위치로 실행하지 않고 카드 ${id}를 남겼습니다.`
      }
    }

    let ok: boolean
    try {
      ok = (await plan.run()).ok && !flight.abort.signal.aborted
    } catch {
      ok = false
    }
    // 중간에 중지돼도 이미 시작된 외부 동작의 결과는 알 수 없으므로 실패로 기록하고 재시도하지 않는다.
    await deps.ledger.settle(plan.idemKey, ok ? 'executed' : 'failed')
    const logged = await this.record(
      ctx,
      plan,
      ok ? 'executed' : flight.abort.signal.aborted ? 'blocked-killswitch' : 'failed',
      'auto',
      count
    )
    if (ok)
      return {
        status: 'executed',
        message: `${ACTION_LABEL[plan.action]}을 실행했습니다. (${plan.target}, 오늘 ${count})${logged ? '' : ' 감사 기록을 쓰지 못했습니다.'}`
      }
    const id = await this.card(
      ctx,
      plan,
      flight.abort.signal.aborted ? '킬 스위치로 중단했습니다.' : '실행에 실패했습니다.',
      'failure'
    )
    return {
      status: 'failed',
      cardId: id,
      message: `${ACTION_LABEL[plan.action]}에 실패했습니다. 재시도하지 않고 카드 ${id}를 남겼습니다.`
    }
  }
}
