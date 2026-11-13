import { describe, expect, it, vi } from 'vitest'
import { parseSchedule } from './schedule-config'
import { Scheduler, type LastRunStore, type SchedulerClock, type SchedulerDeps } from './scheduler'

const MIN = 60_000

class FakeClock implements SchedulerClock {
  t: number
  private timers: { at: number; fn: () => void; id: number }[] = []
  private seq = 0
  constructor(start: Date) {
    this.t = start.getTime()
  }
  now(): number {
    return this.t
  }
  setTimer(fn: () => void, ms: number): () => void {
    const id = this.seq++
    this.timers.push({ at: this.t + ms, fn, id })
    return () => {
      this.timers = this.timers.filter((x) => x.id !== id)
    }
  }
  /** 시간을 흘리며 도달한 타이머를 실행하고, 비동기 후속 작업이 끝나길 기다린다. */
  async advance(ms: number): Promise<void> {
    const end = this.t + ms
    for (;;) {
      const due = this.timers.filter((x) => x.at <= end).sort((a, b) => a.at - b.at)[0]
      if (!due) break
      this.timers = this.timers.filter((x) => x.id !== due.id)
      this.t = due.at
      due.fn()
      await flush()
    }
    this.t = end
  }
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
  await new Promise((r) => setImmediate(r))
}

function memStore(initial: number | null = null): LastRunStore & { value: number | null } {
  const s = {
    value: initial,
    load: async () => s.value,
    save: async (_k: string, at: number) => {
      s.value = at
    }
  }
  return s
}

const SCHEDULE_ON = '- interval_minutes: 60\n- active_hours: 09:00-22:00\n- enabled: true\n'

function setup(opts: {
  start?: Date
  schedule?: string | null
  lastRun?: number | null
  tick?: SchedulerDeps['tick']
  extra?: Partial<SchedulerDeps>
}): {
  clock: FakeClock
  sched: Scheduler
  tick: ReturnType<typeof vi.fn>
  store: ReturnType<typeof memStore>
  schedule: { text: string | null }
} {
  const clock = new FakeClock(opts.start ?? new Date(2026, 10, 16, 10, 0))
  const store = memStore(opts.lastRun ?? null)
  const tick = vi.fn(opts.tick ?? (async () => undefined))
  const schedule = { text: opts.schedule === undefined ? SCHEDULE_ON : opts.schedule }
  const sched = new Scheduler({
    clock,
    companyKey: () => '/co',
    loadSchedule: async () => parseSchedule(schedule.text),
    lastRuns: store,
    tick,
    pollMs: MIN,
    ...opts.extra
  })
  return { clock, sched, tick, store, schedule }
}

describe('Scheduler', () => {
  it('runs a missed tick once at startup, not once per missed interval', async () => {
    const start = new Date(2026, 10, 16, 10, 0)
    const { sched, tick } = setup({ start, lastRun: start.getTime() - 10 * 60 * MIN })
    await sched.start()
    await sched.whenIdle()
    expect(tick).toHaveBeenCalledTimes(1)
    expect(tick.mock.calls[0][0].trigger).toBe('startup-catchup')
    sched.stop()
  })

  it('does not run at startup when the last run is recent', async () => {
    const start = new Date(2026, 10, 16, 10, 0)
    const { sched, tick } = setup({ start, lastRun: start.getTime() - 10 * MIN })
    await sched.start()
    await sched.whenIdle()
    expect(tick).not.toHaveBeenCalled()
    sched.stop()
  })

  it('runs again after the interval elapses', async () => {
    const { sched, tick, clock } = setup({})
    await sched.start()
    await sched.whenIdle()
    expect(tick).toHaveBeenCalledTimes(1)
    await clock.advance(30 * MIN)
    expect(tick).toHaveBeenCalledTimes(1)
    await clock.advance(31 * MIN)
    expect(tick).toHaveBeenCalledTimes(2)
    sched.stop()
  })

  it('never runs when disabled or the file is missing', async () => {
    const off = setup({ schedule: '- enabled: false\n' })
    await off.sched.start()
    const missing = setup({ schedule: null })
    await missing.sched.start()
    await off.clock.advance(5 * 60 * MIN)
    expect(off.tick).not.toHaveBeenCalled()
    expect(missing.tick).not.toHaveBeenCalled()
    off.sched.stop()
    missing.sched.stop()
  })

  it('waits for active hours', async () => {
    const { sched, tick, clock } = setup({ start: new Date(2026, 10, 16, 7, 0) })
    await sched.start()
    expect(tick).not.toHaveBeenCalled()
    await clock.advance(119 * MIN)
    expect(tick).not.toHaveBeenCalled()
    await clock.advance(2 * MIN) // 09:01
    expect(tick).toHaveBeenCalledTimes(1)
    sched.stop()
  })

  it('picks up schedule file edits on the next poll', async () => {
    const { sched, tick, clock, schedule } = setup({ schedule: '- enabled: false\n' })
    await sched.start()
    expect(tick).not.toHaveBeenCalled()
    schedule.text = SCHEDULE_ON
    await clock.advance(2 * MIN)
    expect(tick).toHaveBeenCalledTimes(1)
    sched.stop()
  })

  it('holds a lock so only one tick runs at a time', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((r) => (release = r))
    const { sched, tick, clock } = setup({ tick: () => gate })
    await sched.start()
    expect(sched.getStatus().state).toBe('running')
    expect(await sched.runNow()).toEqual({ started: false, reason: 'busy' })
    await clock.advance(5 * 60 * MIN) // 간격이 지나도 중복 시작하지 않는다
    expect(tick).toHaveBeenCalledTimes(1)
    release()
    await sched.whenIdle()
    expect(sched.getStatus().state).toBe('idle')
    expect(sched.getStatus().lastResult).toBe('ok')
    sched.stop()
  })

  it('runNow ignores enabled and hours but respects no-company and halt', async () => {
    const off = setup({ schedule: null, start: new Date(2026, 10, 16, 3, 0) })
    expect(await off.sched.runNow()).toEqual({ started: true })
    await off.sched.whenIdle()
    expect(off.tick.mock.calls[0][0].trigger).toBe('run-now')

    const halted = setup({ extra: { isHalted: () => true } })
    expect(await halted.sched.runNow()).toEqual({ started: false, reason: 'halted' })

    const none = setup({ extra: { companyKey: () => null } })
    expect(await none.sched.runNow()).toEqual({ started: false, reason: 'no-company' })
    expect(none.tick).not.toHaveBeenCalled()
  })

  it('treats an unreadable halt state as halted', async () => {
    const { sched, tick } = setup({
      extra: {
        isHalted: () => {
          throw new Error('x')
        }
      }
    })
    await sched.start()
    expect(tick).not.toHaveBeenCalled()
    sched.stop()
  })

  it('records a failed tick and does not retry before the interval', async () => {
    const { sched, tick, clock } = setup({
      tick: async () => {
        throw new Error('boom')
      }
    })
    await sched.start()
    await sched.whenIdle()
    expect(sched.getStatus().lastResult).toBe('failed')
    await clock.advance(30 * MIN)
    expect(tick).toHaveBeenCalledTimes(1)
    sched.stop()
  })

  it('calls the pre-tick hook before the tick and survives its failure', async () => {
    const order: string[] = []
    const { sched } = setup({
      tick: async () => {
        order.push('tick')
      }
    })
    sched.setPreTickHook(async () => {
      order.push('hook')
      throw new Error('materialize failed')
    })
    await sched.start()
    await sched.whenIdle()
    expect(order).toEqual(['hook', 'tick'])
    sched.stop()
  })

  it('narrows allowed projects by policy hours and skips when none are allowed', async () => {
    // 2026-11-16 월요일 10:00
    const entries = [
      { projectId: 'a', hours: '월-금 09:00-18:00' },
      { projectId: 'b', hours: '주말' },
      { projectId: 'c', hours: null },
      { projectId: 'd', hours: '오전에만' }
    ]
    const s = setup({ extra: { loadPolicyHours: async () => entries } })
    await s.sched.start()
    await s.sched.whenIdle()
    expect(s.tick.mock.calls[0][0].allowedProjectIds).toEqual(['a', 'c'])
    s.sched.stop()

    const blocked = setup({
      extra: { loadPolicyHours: async () => [{ projectId: 'b', hours: '주말' }] }
    })
    await blocked.sched.start()
    expect(blocked.tick).not.toHaveBeenCalled()
    // 지금 실행은 정책 시간으로 걸러내지 않는다.
    await blocked.sched.runNow()
    await blocked.sched.whenIdle()
    expect(blocked.tick.mock.calls[0][0].allowedProjectIds).toEqual(['b'])
    blocked.sched.stop()
  })

  it('fails closed on unreadable policies, unparseable text and lookup errors', async () => {
    const s = setup({
      extra: {
        loadPolicyHours: async () => [
          { projectId: 'ok', hours: null },
          { projectId: 'text', hours: '오전에만' },
          { projectId: 'bad', hours: null, unreadable: true }
        ]
      }
    })
    await s.sched.start()
    await s.sched.whenIdle()
    expect(s.tick.mock.calls[0][0].allowedProjectIds).toEqual(['ok'])
    expect(s.sched.getStatus().warnings).toHaveLength(2)
    s.sched.stop()

    const thrown = setup({
      extra: {
        loadPolicyHours: async () => {
          throw new Error('x')
        }
      }
    })
    await thrown.sched.start()
    expect(thrown.tick).not.toHaveBeenCalled()
    expect(thrown.sched.getStatus().warnings).toHaveLength(1)
    expect(await thrown.sched.runNow()).toEqual({ started: false, reason: 'policy-unavailable' })
    expect(thrown.tick).not.toHaveBeenCalled()
    thrown.sched.stop()
  })

  it('does not start two ticks when loadPolicyHours is slow (runNow vs poll race)', async () => {
    const releases: (() => void)[] = []
    const loadPolicyHours = async (): Promise<{ projectId: string; hours: string | null }[]> => {
      await new Promise<void>((r) => releases.push(r))
      return [{ projectId: 'a', hours: null }]
    }
    let finish: () => void = () => undefined
    const s = setup({
      tick: () => new Promise<void>((r) => (finish = r)),
      extra: { loadPolicyHours }
    })
    const startP = s.sched.start() // evaluate가 정책 조회에서 대기
    await flush()
    const runP = s.sched.runNow() // 같은 지점에서 대기
    await flush()
    expect(releases).toHaveLength(2)
    releases[1]() // runNow가 먼저 끝나 틱을 시작한다
    await flush()
    releases[0]() // evaluate는 잠금을 보고 물러나야 한다
    await startP
    expect(await runP).toEqual({ started: true })
    expect(s.tick).toHaveBeenCalledTimes(1)
    finish()
    await s.sched.whenIdle()
    s.sched.stop()
  })

  it('keeps last-run per company', async () => {
    let key = '/a'
    const store: LastRunStore = {
      load: async (k) => (k === '/a' ? Date.UTC(2026, 10, 16) + 10 * 3600_000 : null),
      save: async () => undefined
    }
    const clock = new FakeClock(new Date(Date.UTC(2026, 10, 16) + 10 * 3600_000))
    const tick = vi.fn(async () => undefined)
    const sched = new Scheduler({
      clock,
      companyKey: () => key,
      loadSchedule: async () =>
        parseSchedule('- interval_minutes: 600\n- active_hours: 00:00-23:59\n- enabled: true\n'),
      lastRuns: store,
      tick,
      pollMs: MIN
    })
    await sched.start()
    expect(tick).not.toHaveBeenCalled()
    key = '/b'
    await clock.advance(2 * MIN)
    expect(tick).toHaveBeenCalledTimes(1)
    sched.stop()
  })

  it('stop aborts the running tick and cancels the timer', async () => {
    let signal: AbortSignal | undefined
    const { sched, tick, clock } = setup({
      tick: async (ctx) => {
        signal = ctx.signal
        await new Promise<void>((r) => ctx.signal.addEventListener('abort', () => r()))
      }
    })
    await sched.start()
    sched.stop()
    await sched.whenIdle()
    expect(signal?.aborted).toBe(true)
    await clock.advance(5 * 60 * MIN)
    expect(tick).toHaveBeenCalledTimes(1)
  })

  describe('resumeAfterDecision', () => {
    it('runs the next tick right away without waiting for the interval', async () => {
      const { sched, tick, clock } = setup({})
      await sched.start()
      await sched.whenIdle()
      await clock.advance(5 * MIN)
      expect(tick).toHaveBeenCalledTimes(1)
      await sched.resumeAfterDecision()
      await sched.whenIdle()
      expect(tick).toHaveBeenCalledTimes(2)
      expect(tick.mock.calls[1][0].trigger).toBe('decision')
      sched.stop()
    })

    it('waits for a running tick to finish and then runs exactly one more tick', async () => {
      let release: () => void = () => undefined
      const gate = new Promise<void>((r) => (release = r))
      let calls = 0
      const { sched, tick } = setup({
        tick: async () => {
          calls++
          if (calls === 1) await gate
        }
      })
      await sched.start()
      await flush()
      expect(tick).toHaveBeenCalledTimes(1)
      await sched.resumeAfterDecision()
      await sched.resumeAfterDecision()
      await flush()
      expect(tick).toHaveBeenCalledTimes(1)
      release()
      await flush()
      await sched.whenIdle()
      expect(tick).toHaveBeenCalledTimes(2)
      expect(tick.mock.calls[1][0].trigger).toBe('decision')
      sched.stop()
    })

    it('does nothing when auto run is off, halted, outside active hours, or stopped', async () => {
      const off = setup({ schedule: '- enabled: false\n' })
      await off.sched.start()
      await off.sched.resumeAfterDecision()
      const halted = setup({ extra: { isHalted: () => true } })
      await halted.sched.start()
      await halted.sched.resumeAfterDecision()
      const night = setup({ start: new Date(2026, 10, 16, 3, 0) })
      await night.sched.start()
      await night.sched.resumeAfterDecision()
      const stopped = setup({})
      await stopped.sched.resumeAfterDecision()
      for (const x of [off, halted, night, stopped]) {
        await x.sched.whenIdle()
        expect(x.tick).not.toHaveBeenCalled()
        x.sched.stop()
      }
    })
  })
})

describe('Scheduler external block (CEO chat)', () => {
  it('does not start a tick or run-now while another run holds the company folder', async () => {
    const blocked = { value: true }
    const { sched, tick } = setup({ extra: { isBlocked: () => blocked.value } })
    expect(await sched.runNow()).toEqual({ started: false, reason: 'busy' })
    await sched.start()
    await sched.whenIdle()
    expect(tick).not.toHaveBeenCalled()
    blocked.value = false
    expect(await sched.runNow()).toEqual({ started: true })
    await sched.whenIdle()
    expect(tick).toHaveBeenCalledTimes(1)
    sched.stop()
  })
})
