import { describe, expect, it } from 'vitest'
import type { RunEvent } from '../../shared/run'
import type { ProviderAdapter, RunLaunchOptions } from '../providers/types'
import type { TickContext } from '../scheduler/scheduler'
import { createTickRunner } from './tick-runner'
import { agent, org, policyState, project, snapshot, ticket } from './tick-test-kit'
import type { TickDeps, TickSnapshot } from './tick-types'

interface Start {
  cwd: string
  prompt: string
  timeoutMs: number
  launch: RunLaunchOptions | undefined
}

type Behavior = 'ok' | 'fail' | 'timeout' | 'hang' | 'start-error'

function fakeAdapter(
  cwd: string,
  starts: Start[],
  behavior: Behavior,
  cancels: string[]
): ProviderAdapter {
  return {
    id: 'claude',
    capabilities: { toolBridge: true, pathScopedWrites: true },
    agentTranslator: { translate: () => [] },
    checkInstall: async () => ({ installed: true, version: null }),
    extractUsage: () => null,
    cancelAll: () => undefined,
    cancel: (id) => {
      cancels.push(id)
      return true
    },
    start: (req, emit, launch) => {
      const r = req as { prompt: string; timeoutMs: number }
      starts.push({ cwd, prompt: r.prompt, timeoutMs: r.timeoutMs, launch })
      if (behavior === 'start-error') return { ok: false, code: 'spawn-failed', message: 'x' }
      const send = (e: Record<string, unknown>): void => emit({ runId: 'r1', ...e } as RunEvent)
      if (behavior !== 'hang')
        queueMicrotask(() => {
          if (behavior === 'ok')
            send({
              type: 'result',
              success: true,
              subtype: 'success',
              text: '끝',
              costUsd: null,
              durationMs: null,
              numTurns: null
            })
          if (behavior === 'fail') send({ type: 'error', code: 'exit-nonzero', message: 'x' })
          if (behavior === 'timeout') send({ type: 'error', code: 'timeout', message: 'x' })
          send({ type: 'exit', exitCode: behavior === 'ok' ? 0 : 1, signal: null })
        })
      return { ok: true, runId: 'r1' }
    }
  }
}

interface Harness {
  deps: TickDeps
  starts: Start[]
  reports: Map<string, string>
  cards: string[]
  cancels: string[]
  disposed: { n: number }
  run: (ctx?: Partial<TickContext>) => Promise<void>
}

function harness(
  opts: { snap?: Partial<TickSnapshot>; behavior?: Behavior; deps?: Partial<TickDeps> } = {}
): Harness {
  const starts: Start[] = []
  const reports = new Map<string, string>()
  const cards: string[] = []
  const cancels: string[] = []
  const disposed = { n: 0 }
  const deps: TickDeps = {
    now: () => new Date('2026-11-13T10:00:00.000Z'),
    companyDir: () => '/company',
    loadSnapshot: async () =>
      snapshot({
        tickets: [ticket('T-001', { projectId: 'alpha' })],
        projects: [project('alpha')],
        ...opts.snap
      }),
    loadPolicy: async () => policyState(),
    readAgentPrompt: async () => '직원 본문',
    resolveProjectDir: async (id) => `/projects/${id}`,
    createAdapter: (cwd) => fakeAdapter(cwd, starts, opts.behavior ?? 'ok', cancels),
    writeReport: async (id, md) => {
      if (reports.has(id)) return 'exists'
      reports.set(id, md)
      return 'written'
    },
    createCard: async (c) => {
      cards.push(c.title)
      return `D-${cards.length}`
    },
    isKillSwitchEngaged: async () => false,
    checkLimit: async () => ({ ok: true, reason: '' }),
    ...opts.deps
  }
  const run = (ctx: Partial<TickContext> = {}): Promise<void> =>
    createTickRunner(deps)({
      trigger: 'timer',
      allowedProjectIds: null,
      signal: new AbortController().signal,
      ...ctx
    })
  return { deps, starts, reports, cards, cancels, disposed, run }
}

const briefing = (h: Harness): string => [...h.reports.values()].join('\n')

describe('createTickRunner', () => {
  it('runs a project ticket in the registered project folder and writes a briefing', async () => {
    const h = harness()
    await h.run()
    expect(h.starts).toHaveLength(1)
    expect(h.starts[0].cwd).toBe('/projects/alpha')
    expect(h.starts[0].prompt).toContain('T-001')
    expect(briefing(h)).toContain('- **결과:** 완료')
    expect([...h.reports.keys()][0]).toBe('briefing-20261113100000')
  })

  it('runs company-wide tickets in the company folder as COO', async () => {
    const h = harness({ snap: { tickets: [ticket('T-009')], projects: [] } })
    await h.run()
    expect(h.starts[0].cwd).toBe('/company')
    expect(h.starts[0].prompt).toContain('너는 COO다')
  })

  it('does not run when no limit check is injected (most conservative)', async () => {
    const h = harness({ deps: { checkLimit: undefined } })
    await h.run()
    expect(h.starts).toHaveLength(0)
    expect(briefing(h)).toContain('한도 점검이 연결되지 않아')
  })

  it('does not run and leaves one decision card when the limit is at risk', async () => {
    const h = harness({
      deps: { checkLimit: async () => ({ ok: false, reason: '주간 한도 90%' }) }
    })
    const shared = { lastLimitCardAt: 0 }
    const deps = h.deps
    const runner = createTickRunner(deps, shared)
    const ctx: TickContext = {
      trigger: 'timer',
      allowedProjectIds: null,
      signal: new AbortController().signal
    }
    await runner(ctx)
    await runner(ctx)
    expect(h.starts).toHaveLength(0)
    expect(h.cards).toHaveLength(1)
    expect(briefing(h)).toContain('한도 초과 위험: 주간 한도 90%')
  })

  it('treats a throwing limit check as blocked', async () => {
    const h = harness({
      deps: {
        checkLimit: async () => {
          throw new Error('boom')
        }
      }
    })
    await h.run()
    expect(h.starts).toHaveLength(0)
  })

  it('skips pm-required projects, files an hr request and does not run', async () => {
    const requests: string[] = []
    const h = harness({
      snap: { projects: [project('alpha', { pmId: null, pm: null, state: 'pm-required' })] },
      deps: {
        requests: {
          requestHr: async (r) => void requests.push(`${r.kind}:${r.idemKey}`),
          proposeAssignment: async () => undefined
        }
      }
    })
    await h.run()
    expect(h.starts).toHaveLength(0)
    expect(requests).toEqual(['pm-required:pm-required:alpha'])
    expect(briefing(h)).toContain('PM 필요: 프로젝트 alpha')
  })

  it('proposes an assignment for an unassigned assignee', async () => {
    const proposals: string[] = []
    const h = harness({
      snap: { projects: [project('alpha', { memberIds: [] })] },
      deps: {
        requests: {
          requestHr: async () => undefined,
          proposeAssignment: async (p) => void proposals.push(p.idemKey)
        }
      }
    })
    await h.run()
    expect(h.starts).toHaveLength(0)
    expect(proposals).toEqual(['assign:alpha:developer'])
  })

  it('briefs hire needed without failing when the assignee is missing', async () => {
    const h = harness({ snap: { tickets: [ticket('T-001', { assignee: 'ghost' })] } })
    await expect(h.run()).resolves.toBeUndefined()
    expect(briefing(h)).toContain('채용 필요')
  })

  it('does not run quarantined employees', async () => {
    const h = harness({ snap: { quarantined: new Set(['developer']) } })
    await h.run()
    expect(h.starts).toHaveLength(0)
    expect(briefing(h)).toContain('격리된 직원')
  })

  it('handles an empty allowed list as no projects', async () => {
    const h = harness()
    await h.run({ allowedProjectIds: [] })
    expect(h.starts).toHaveLength(0)
  })

  it('does not run when the project folder cannot be resolved', async () => {
    const h = harness({ deps: { resolveProjectDir: async () => null } })
    await h.run()
    expect(h.starts).toHaveLength(0)
    expect(briefing(h)).toContain('프로젝트 폴더를 확인하지 못해')
  })

  it('downgrades auto modes to every when the kill switch is on or unreadable', async () => {
    const auto = policyState({
      modes: { push: 'auto', merge: 'every', publish: 'every', 'draft-approve': 'every' }
    })
    for (const engaged of [
      async () => true,
      async () => {
        throw new Error('unreadable')
      },
      undefined
    ]) {
      const h = harness({
        deps: { loadPolicy: async () => auto, isKillSwitchEngaged: engaged }
      })
      await h.run()
      expect(h.starts[0].prompt).not.toContain('승인 모드: 자동')
    }
  })

  it('keeps auto mode only with a bridge, a clear kill switch and an effective policy', async () => {
    const auto = policyState({
      modes: { push: 'auto', merge: 'every', publish: 'every', 'draft-approve': 'every' }
    })
    const disposed = { n: 0 }
    const h = harness({
      deps: {
        loadPolicy: async () => auto,
        prepareToolRun: async () => ({
          autoAllowed: true,
          launch: {},
          dispose: async () => void disposed.n++
        })
      }
    })
    await h.run()
    expect(h.starts[0].prompt).toContain('푸시 승인 모드: 자동')
    expect(disposed.n).toBe(1)
  })

  it('falls back to every when the bridge fails, and still runs', async () => {
    const auto = policyState({
      modes: { push: 'auto', merge: 'every', publish: 'every', 'draft-approve': 'every' }
    })
    const h = harness({
      deps: {
        loadPolicy: async () => auto,
        prepareToolRun: async () => {
          throw new Error('x')
        }
      }
    })
    await h.run()
    expect(h.starts[0].prompt).not.toContain('승인 모드: 자동')
    expect(briefing(h)).toContain('도구 연결에 실패')
  })

  it('writes a failed briefing, disposes the bridge and rethrows on failure', async () => {
    const disposed = { n: 0 }
    const h = harness({
      behavior: 'fail',
      deps: {
        prepareToolRun: async () => ({
          autoAllowed: true,
          launch: {},
          dispose: async () => void disposed.n++
        })
      }
    })
    await expect(h.run()).rejects.toThrow('tick-failed')
    expect(briefing(h)).toContain('- **결과:** 실패')
    expect(disposed.n).toBe(1)
  })

  it('marks timeouts and a start failure as failed, with fixed messages', async () => {
    const t = harness({ behavior: 'timeout' })
    await expect(t.run()).rejects.toThrow('tick-timeout')
    expect(briefing(t)).toContain('시간 초과')
    const s = harness({ behavior: 'start-error' })
    await expect(s.run()).rejects.toThrow('tick-failed')
    expect(briefing(s)).toContain('CLI를 시작하지 못했어요')
  })

  it('leaves no state behind: the next tick runs normally after a failure', async () => {
    const h = harness({ behavior: 'fail' })
    await expect(h.run()).rejects.toThrow()
    h.deps.createAdapter = (cwd) => fakeAdapter(cwd, h.starts, 'ok', h.cancels)
    h.deps.now = () => new Date('2026-11-13T10:30:00.000Z')
    await expect(h.run()).resolves.toBeUndefined()
    expect(h.reports.size).toBe(2)
  })

  it('cancels the run when the signal aborts and does not throw', async () => {
    const h = harness({ behavior: 'hang' })
    const ac = new AbortController()
    const p = h.run({ signal: ac.signal })
    await new Promise((r) => setTimeout(r, 20))
    expect(h.cancels).toEqual([])
    ac.abort()
    expect(h.cancels).toEqual(['r1'])
    // 가짜 어댑터는 취소해도 exit을 내지 않으므로 여기서는 취소 호출만 확인한다.
    void p
  })

  it('does nothing when already aborted', async () => {
    const h = harness()
    const ac = new AbortController()
    ac.abort()
    await h.run({ signal: ac.signal })
    expect(h.starts).toHaveLength(0)
    expect(h.reports.size).toBe(0)
  })

  it('does not start a run when aborted after planning', async () => {
    const ac = new AbortController()
    const h = harness({
      deps: {
        checkLimit: async () => {
          ac.abort()
          return { ok: true, reason: '' }
        }
      }
    })
    await h.run({ signal: ac.signal })
    expect(h.starts).toHaveLength(0)
    expect(briefing(h)).toContain('취소됨')
  })

  it('connects hr-only runs only when requests are pending', async () => {
    const calls: string[] = []
    const mk = (n: number): Partial<TickDeps> => ({
      hr: {
        pending: async () => n,
        run: async () => void calls.push('run')
      }
    })
    await harness({ deps: mk(0) }).run()
    expect(calls).toEqual([])
    await harness({ deps: mk(2) }).run()
    expect(calls).toEqual(['run'])
    const failing = harness({
      deps: {
        hr: {
          pending: async () => 1,
          run: async () => {
            throw new Error('x')
          }
        }
      }
    })
    await failing.run()
    expect(failing.starts).toHaveLength(1)
    expect(briefing(failing)).toContain('hr 전용 실행에 실패')
  })

  it('records a snapshot failure as failed without leaking details', async () => {
    const h = harness({
      deps: {
        loadSnapshot: async () => {
          throw new Error('/secret/path')
        }
      }
    })
    await expect(h.run()).rejects.toThrow('tick-failed')
    expect(briefing(h)).not.toContain('/secret/path')
  })

  it('retries the briefing id when it already exists', async () => {
    const h = harness()
    h.reports.set('briefing-20261113100000', 'old')
    await h.run()
    expect([...h.reports.keys()]).toContain('briefing-20261113100000-2')
    expect(h.reports.get('briefing-20261113100000')).toBe('old')
  })

  it('uses the org for assignee lookup (developer unknown to the org)', async () => {
    const h = harness({ snap: { org: org(agent('pm', 'PM')) } })
    await h.run()
    expect(h.starts).toHaveLength(0)
  })

  it('runs hr only after the limit check passes', async () => {
    const order: string[] = []
    const hr = { pending: async () => 1, run: async () => void order.push('hr') }
    const h = harness({
      deps: {
        hr,
        checkLimit: async () => {
          order.push('limit')
          return { ok: true, reason: '' }
        }
      }
    })
    await h.run()
    expect(order).toEqual(['limit', 'hr'])
    const blocked = harness({
      deps: { hr, checkLimit: async () => ({ ok: false, reason: '초과' }) }
    })
    order.length = 0
    await blocked.run()
    expect(order).toEqual([])
    const none = harness({ deps: { hr, checkLimit: undefined } })
    await none.run()
    expect(order).toEqual([])
  })

  it('escapes a result text that contains a long backtick fence in the briefing', async () => {
    const h = harness()
    h.deps.createAdapter = (cwd) => {
      const a = fakeAdapter(cwd, h.starts, 'ok', h.cancels)
      const start = a.start
      a.start = (req, emit, launch) =>
        start(
          req,
          (e) => emit(e.type === 'result' ? { ...e, text: '```````\n## 가짜' } : e),
          launch
        )
      return a
    }
    await h.run()
    expect(briefing(h)).toContain('````````text')
  })
})
