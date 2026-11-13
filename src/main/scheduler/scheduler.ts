import type {
  SchedulerRunNowResult,
  SchedulerSkipReason,
  SchedulerStatus
} from '../../shared/scheduler'
import { isWithinCompanyHours, isWithinWindow, parsePolicyHours } from './active-window'
import { DISABLED_SCHEDULE, type ParsedSchedule } from './schedule-config'

export interface SchedulerClock {
  now(): number
  /** 반환된 함수로 취소한다. */
  setTimer(fn: () => void, ms: number): () => void
}

export const systemClock: SchedulerClock = {
  now: () => Date.now(),
  setTimer: (fn, ms) => {
    const t = setTimeout(fn, ms)
    // 타이머만 남아 프로세스를 붙잡지 않게 한다 (종료는 앱 라이프사이클이 정한다).
    t.unref()
    return () => clearTimeout(t)
  }
}

export interface PolicyHoursEntry {
  projectId: string
  /** 프로젝트 정책의 `활동 요일·시간` 원문. 없으면 null. */
  hours: string | null
}

export interface TickContext {
  trigger: 'timer' | 'startup-catchup' | 'run-now'
  /**
   * 이번 틱에서 다룰 수 있는 프로젝트 id. 정책 활동 시간 밖인 프로젝트는 빠진다.
   * 프로젝트 정보를 얻지 못하면 null(제한 없음).
   */
  allowedProjectIds: string[] | null
  signal: AbortSignal
}

export interface LastRunStore {
  load(key: string): Promise<number | null>
  save(key: string, at: number): Promise<void>
}

export interface SchedulerDeps {
  clock?: SchedulerClock
  /** 열린 회사의 식별자(경로). 열린 회사가 없으면 null. 회사가 바뀌면 마지막 실행 시각도 그 회사 것으로 바뀐다. */
  companyKey: () => string | null
  loadSchedule: () => Promise<ParsedSchedule>
  loadPolicyHours?: () => Promise<PolicyHoursEntry[]>
  lastRuns: LastRunStore
  /** 실제 틱 내용(COO 틱, T-016). 이 안에서의 푸시·머지·발행은 반드시 T-053 게이트를 거쳐야 한다. */
  tick: (ctx: TickContext) => Promise<void>
  /** 회사 전체 킬 스위치 등으로 자동 실행을 멈춰야 하면 true. 읽지 못하면 true로 답해야 안전하다. */
  isHalted?: () => Promise<boolean> | boolean
  /** 점검 주기. 설정 파일 변경과 활동 시간 진입을 이 주기로 반영한다. */
  pollMs?: number
  onChange?: () => void
}

export type PreTickHook = (signal: AbortSignal) => Promise<void>

const DEFAULT_POLL_MS = 30_000

export class Scheduler {
  private readonly clock: SchedulerClock
  private readonly pollMs: number
  private schedule: ParsedSchedule = { config: { ...DISABLED_SCHEDULE }, warnings: [] }
  private lastRunAt: number | null = null
  private lastKey: string | null = null
  private lastResult: 'ok' | 'failed' | null = null
  private running: Promise<void> | null = null
  private abort: AbortController | null = null
  private cancelTimer: (() => void) | null = null
  private started = false
  private preTick: PreTickHook | null = null

  constructor(private readonly deps: SchedulerDeps) {
    this.clock = deps.clock ?? systemClock
    this.pollMs = deps.pollMs ?? DEFAULT_POLL_MS
  }

  /** 틱 직전에 한 번 호출되는 훅 (정기 티켓 생성 `recurring:materialize`, T-049). 실패해도 틱은 계속한다. */
  setPreTickHook(hook: PreTickHook | null): void {
    this.preTick = hook
  }

  /** 앱 시작 시 호출한다. 밀린 실행이 있으면 한 번만 실행하고 이후는 주기 점검으로 넘어간다. */
  async start(): Promise<void> {
    if (this.started) return
    this.started = true
    await this.poll('startup-catchup')
  }

  stop(): void {
    this.started = false
    this.cancelTimer?.()
    this.cancelTimer = null
    this.abort?.abort()
  }

  /** 진행 중인 틱이 끝나면 resolve된다. 테스트와 종료 처리에서 쓴다. */
  whenIdle(): Promise<void> {
    return this.running ?? Promise.resolve()
  }

  getStatus(): SchedulerStatus {
    const { config, warnings } = this.schedule
    const next =
      config.enabled && this.lastRunAt !== null
        ? this.lastRunAt + config.intervalMinutes * 60_000
        : config.enabled
          ? this.clock.now()
          : null
    return {
      enabled: config.enabled,
      intervalMinutes: config.intervalMinutes,
      activeHours: config.activeHours,
      state: this.running ? 'running' : 'idle',
      lastRunAt: this.lastRunAt,
      nextRunAt: next,
      lastResult: this.lastResult,
      warnings: [...warnings]
    }
  }

  /** 켜기/끄기·간격·활동 시간과 무관하게 지금 한 번 실행한다. 잠금과 킬 스위치는 지킨다. 틱 완료를 기다리지 않는다. */
  async runNow(): Promise<SchedulerRunNowResult> {
    const key = this.deps.companyKey()
    if (key === null) return { started: false, reason: 'no-company' }
    if (this.running) return { started: false, reason: 'busy' }
    if (await this.halted()) return { started: false, reason: 'halted' }
    // await 사이에 다른 틱이 시작됐을 수 있다.
    if (this.running) return { started: false, reason: 'busy' }
    const allowed = await this.allowedProjects(false)
    void this.begin(key, 'run-now', allowed.ids)
    return { started: true }
  }

  private async halted(): Promise<boolean> {
    try {
      return (await this.deps.isHalted?.()) === true
    } catch {
      return true
    }
  }

  private async poll(trigger: 'timer' | 'startup-catchup'): Promise<void> {
    try {
      await this.evaluate(trigger)
    } catch {
      // 점검 실패가 타이머를 끊으면 안 된다. 다음 주기에 다시 시도한다.
    } finally {
      this.arm()
    }
  }

  private arm(): void {
    this.cancelTimer?.()
    this.cancelTimer = null
    if (!this.started) return
    this.cancelTimer = this.clock.setTimer(() => void this.poll('timer'), this.pollMs)
  }

  /** 지금 틱을 시작해야 하는지 판단하고 시작한다. 시작하지 않은 이유를 돌려준다. */
  private async evaluate(
    trigger: 'timer' | 'startup-catchup'
  ): Promise<SchedulerSkipReason | null> {
    const key = this.deps.companyKey()
    if (key === null) {
      this.lastKey = null
      this.lastRunAt = null
      return 'no-company'
    }
    if (key !== this.lastKey) {
      this.lastKey = key
      this.lastRunAt = await this.deps.lastRuns.load(key)
    }
    try {
      this.schedule = await this.deps.loadSchedule()
    } catch {
      this.schedule = {
        config: { ...DISABLED_SCHEDULE },
        warnings: ['스케줄 파일을 읽지 못해 자동 실행을 멈췄어요.']
      }
    }
    this.deps.onChange?.()
    const { config } = this.schedule
    if (!config.enabled) return 'disabled'
    const now = this.clock.now()
    if (this.lastRunAt !== null && now - this.lastRunAt < config.intervalMinutes * 60_000)
      return 'not-due'
    if (this.running) return 'not-due'
    if (!isWithinCompanyHours(new Date(now), config.activeHours)) return 'outside-hours'
    if (await this.halted()) return 'halted'
    const allowed = await this.allowedProjects(true)
    if (allowed.blocked) return 'policy-hours'
    if (this.running) return 'not-due'
    void this.begin(key, trigger, allowed.ids)
    return null
  }

  private async allowedProjects(
    enforce: boolean
  ): Promise<{ ids: string[] | null; blocked: boolean }> {
    if (!this.deps.loadPolicyHours) return { ids: null, blocked: false }
    let entries: PolicyHoursEntry[]
    try {
      entries = await this.deps.loadPolicyHours()
    } catch {
      return { ids: null, blocked: false }
    }
    const now = new Date(this.clock.now())
    // 지금 실행은 정책 시간이 아니라 CEO의 명시적 요청이므로 프로젝트를 걸러내지 않는다.
    const ids = entries
      .filter((e) => {
        if (!enforce || e.hours === null) return true
        const w = parsePolicyHours(e.hours)
        // 해석 못 하는 자유 텍스트는 좁히지 못한다. 회사 활동 시간은 그대로 적용된다.
        return w === null || isWithinWindow(now, w)
      })
      .map((e) => e.projectId)
    return { ids, blocked: enforce && entries.length > 0 && ids.length === 0 }
  }

  private begin(
    key: string,
    trigger: TickContext['trigger'],
    allowedProjectIds: string[] | null
  ): Promise<void> {
    const controller = new AbortController()
    this.abort = controller
    // 시작 시각을 먼저 기록해, 틱이 실패해도 곧바로 다시 도는 폭주를 막는다.
    this.lastRunAt = this.clock.now()
    const startedAt = this.lastRunAt
    const run = (async () => {
      try {
        await this.deps.lastRuns.save(key, startedAt)
      } catch {
        // 기록 실패는 다음 시작 때 밀린 실행이 한 번 더 도는 정도로 끝난다.
      }
      try {
        if (this.preTick) {
          try {
            await this.preTick(controller.signal)
          } catch {
            // 정기 티켓 생성 실패가 이번 틱 전체를 막지 않는다.
          }
        }
        await this.deps.tick({ trigger, allowedProjectIds, signal: controller.signal })
        this.lastResult = 'ok'
      } catch {
        this.lastResult = 'failed'
      } finally {
        this.running = null
        this.abort = null
        this.deps.onChange?.()
      }
    })()
    this.running = run
    this.deps.onChange?.()
    return run
  }
}
