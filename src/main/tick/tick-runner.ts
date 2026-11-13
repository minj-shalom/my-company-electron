import type { TickContext } from '../scheduler/scheduler'
import { briefingId, renderBriefing, type TickOutcome } from './tick-briefing'
import { execOnce, type ExecResult } from './tick-exec'
import { planTick, type Selected, type SideEffect, type TickPlan } from './tick-plan'
import { buildTickPrompt } from './tick-prompt'
import type { TickDeps } from './tick-types'

export const DEFAULT_TICK_TIMEOUT_MS = 30 * 60 * 1000
const CARD_COOLDOWN_MS = 24 * 60 * 60 * 1000
const MAX_BRIEFING_ATTEMPTS = 5

const FAILURE_TEXT: Record<string, string> = {
  'cli-not-found': 'CLI를 찾지 못해 실행하지 못했어요.',
  'spawn-failed': 'CLI를 시작하지 못했어요.',
  'exit-nonzero': 'CLI가 오류로 종료됐어요.',
  'invalid-request': '실행 요청이 올바르지 않아 시작하지 못했어요.',
  timeout: '시간이 초과돼 중단했어요.'
}

/** 틱 사이에 유지하는 값. 틱마다 러너를 새로 만들어도 한도 카드가 매번 쌓이지 않게 한다. */
export interface TickShared {
  lastLimitCardAt: number
}

interface Report {
  outcome: TickOutcome
  ticketId: string | null
  resultText: string | null
  failure: string | null
  decisions: string[]
  notes: string[]
  plan: TickPlan | null
}

/**
 * 스케줄러(T-015)의 tick 콜백. 틱마다 처리할 티켓 하나를 고르고, 제공자 어댑터로 실행하고, 브리핑을 `company/reports/`에 쓴다.
 * 실패와 시간 초과는 브리핑에 남기고 (스케줄러가 failed로 기록하도록) 던진다. 진행 상태를 틱 사이에 들고 있지 않으므로 다음 틱에 영향이 없다.
 * 푸시·머지·발행은 직접 하지 않는다 (게이트 도구 연결 지점만 제공).
 */
export function createTickRunner(
  deps: TickDeps,
  shared: TickShared = { lastLimitCardAt: 0 }
): (ctx: TickContext) => Promise<void> {
  async function pendingHr(r: Report): Promise<boolean> {
    if (!deps.hr) return false
    try {
      return (await deps.hr.pending()) > 0
    } catch {
      r.notes.push('hr 전용 실행에 실패했어요.')
      return false
    }
  }

  async function runHr(signal: AbortSignal, r: Report): Promise<void> {
    try {
      await deps.hr?.run(signal)
    } catch {
      r.notes.push('hr 전용 실행에 실패했어요.')
    }
  }

  async function applyEffects(effects: SideEffect[], r: Report): Promise<void> {
    for (const e of effects) {
      const label =
        e.type === 'hr' ? e.reason : `${e.employeeId}의 ${e.projectId} 프로젝트 배정 제안`
      if (!deps.requests) {
        r.notes.push(`요청 경로가 연결되지 않아 기록만 남김: ${label}`)
        continue
      }
      try {
        if (e.type === 'hr')
          await deps.requests.requestHr({
            kind: e.kind,
            idemKey: `${e.kind}:${e.kind === 'hire' ? e.ticketId : (e.projectId ?? '-')}`,
            ticketId: e.ticketId,
            projectId: e.projectId,
            reason: e.reason
          })
        else
          await deps.requests.proposeAssignment({
            idemKey: `assign:${e.projectId}:${e.employeeId}`,
            projectId: e.projectId,
            employeeId: e.employeeId,
            ticketId: e.ticketId
          })
        r.decisions.push(label)
      } catch {
        r.notes.push(`요청을 만들지 못함: ${label}`)
      }
    }
  }

  /** 한도 점검 주입이 없거나 실패하면 실행하지 않는다. 초과 위험이면 결정 카드를 하루 한 번만 남긴다. */
  async function limitGate(sel: Selected | null, r: Report): Promise<boolean> {
    if (!deps.checkLimit) {
      r.outcome = 'blocked'
      r.failure = '한도 점검이 연결되지 않아 실행하지 않았어요.'
      return false
    }
    let check
    try {
      check = await deps.checkLimit()
    } catch {
      r.outcome = 'blocked'
      r.failure = '한도 점검에 실패해 실행하지 않았어요.'
      return false
    }
    if (check.ok) return true
    r.outcome = 'blocked'
    r.failure = `한도 초과 위험: ${check.reason}`
    const now = deps.now().getTime()
    if (now - shared.lastLimitCardAt >= CARD_COOLDOWN_MS) {
      try {
        const id = await deps.createCard({
          title: '사용량 한도 위험으로 틱을 실행하지 않았어요',
          ticketId: sel?.ticket.id ?? null,
          question: `한도 초과 위험으로 ${sel?.ticket.id ?? '인사 요청 처리'} 실행을 보류했습니다. 계속할까요?`,
          impact: check.reason
        })
        shared.lastLimitCardAt = now
        r.decisions.push(`한도 결정 카드 ${id}`)
      } catch {
        r.notes.push('한도 결정 카드를 만들지 못함')
      }
    }
    return false
  }

  async function killSwitchEngaged(projectId: string | null): Promise<boolean> {
    if (!deps.isKillSwitchEngaged) return true
    try {
      return (
        (await deps.isKillSwitchEngaged(null)) ||
        (projectId !== null && (await deps.isKillSwitchEngaged(projectId)))
      )
    } catch {
      return true
    }
  }

  async function execute(sel: Selected, ctx: TickContext, r: Report): Promise<void> {
    const project = sel.project
    let cwd = deps.companyDir()
    if (project !== null) {
      const dir = await deps.resolveProjectDir(project.id)
      if (dir === null) {
        r.outcome = 'blocked'
        r.failure = `${project.id}: 등록된 프로젝트 폴더를 확인하지 못해 실행하지 않았어요.`
        return
      }
      cwd = dir
    }
    const policy = project !== null ? await deps.loadPolicy(project.id).catch(() => null) : null
    let launch: Awaited<ReturnType<NonNullable<TickDeps['prepareToolRun']>>> | null = null
    try {
      if (project !== null && deps.prepareToolRun) {
        const adapter = deps.createAdapter(cwd)
        launch = await deps.prepareToolRun(
          { projectId: project.id, employeeId: sel.assignee, ticketId: sel.ticket.id },
          adapter.capabilities
        )
      }
    } catch {
      launch = null
      r.notes.push('도구 연결에 실패해 모든 동작을 매번 컨펌으로 대체했어요.')
    }
    try {
      const bridge = launch?.autoAllowed === true
      const forceEvery = project !== null && ((await killSwitchEngaged(project.id)) || !bridge)
      const prompt = buildTickPrompt({
        ticket: sel.ticket,
        project,
        policy,
        forceEvery,
        bridge,
        assigneeId: sel.assignee,
        assigneePrompt: project !== null ? await deps.readAgentPrompt(sel.assignee) : null,
        pmId: sel.pmId,
        mode: project !== null ? 'project' : 'coo'
      })
      if (ctx.signal.aborted) {
        r.outcome = 'cancelled'
        return
      }
      const res: ExecResult = await execOnce(
        deps.createAdapter(cwd),
        prompt,
        deps.timeoutMs ?? DEFAULT_TICK_TIMEOUT_MS,
        launch?.launch ?? {},
        ctx.signal
      )
      r.resultText = res.text
      if (res.error === 'cancelled') r.outcome = 'cancelled'
      else if (res.error === 'timeout') {
        r.outcome = 'timeout'
        r.failure = FAILURE_TEXT.timeout
      } else if (res.error !== null || res.resultFailed) {
        r.outcome = 'failed'
        r.failure = FAILURE_TEXT[res.error ?? ''] ?? '실행이 실패로 끝났어요.'
      } else r.outcome = 'ok'
    } finally {
      await launch?.dispose().catch(() => undefined)
    }
  }

  async function writeBriefing(at: Date, trigger: string, r: Report): Promise<void> {
    for (let attempt = 0; attempt < MAX_BRIEFING_ATTEMPTS; attempt++) {
      const md = renderBriefing({
        at,
        trigger,
        outcome: r.outcome,
        ticketId: r.ticketId,
        resultText: r.resultText,
        failure: r.failure,
        skipped: r.plan?.skipped ?? [],
        notes: [...(r.plan?.notes ?? []), ...r.notes],
        decisions: r.decisions
      })
      if ((await deps.writeReport(briefingId(at, attempt), md)) === 'written') return
    }
    throw new Error('briefing-write-failed')
  }

  return async (ctx) => {
    if (ctx.signal.aborted) return
    const at = deps.now()
    const r: Report = {
      outcome: 'idle',
      ticketId: null,
      resultText: null,
      failure: null,
      decisions: [],
      notes: [],
      plan: null
    }
    try {
      const snapshot = await deps.loadSnapshot()
      r.plan = planTick(snapshot, ctx.allowedProjectIds)
      await applyEffects(r.plan.effects, r)
      const sel = r.plan.selected
      if (sel === null) r.outcome = r.plan.skipped.length > 0 ? 'blocked' : 'idle'
      const hrPending = await pendingHr(r)
      if (sel === null && !hrPending) {
        // 실행할 것이 없으면 한도 점검도 필요 없다.
      } else if (ctx.signal.aborted) r.outcome = 'cancelled'
      else if (await limitGate(sel, r)) {
        // hr 전용 실행도 LLM 실행이므로 한도 점검을 통과한 뒤에만 한다.
        if (hrPending) await runHr(ctx.signal, r)
        if (sel !== null) {
          r.ticketId = sel.ticket.id
          await execute(sel, ctx, r)
        }
      }
    } catch {
      r.outcome = 'failed'
      r.failure = '틱을 준비하는 중 오류가 나서 실행하지 못했어요.'
    }
    await writeBriefing(at, ctx.trigger, r)
    if (r.outcome === 'failed' || r.outcome === 'timeout') throw new Error(`tick-${r.outcome}`)
  }
}
