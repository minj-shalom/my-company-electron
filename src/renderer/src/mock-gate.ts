import type { WindowApi } from '../../shared/api'
import {
  AUDIT_RESULTS,
  type AuditProjectSummary,
  type AuditSummary,
  type KillSwitchState
} from '../../shared/gate'
import { LIMITED_ACTIONS, type LimitedAction } from '../../shared/policy'

/**
 * 브라우저 개발 모드 전용. `?mock-gate=ok|empty|paused|error|loading`.
 * ok: my-company에 오늘 실행·실패 기록이 있다. empty: 기록 없음. paused: 전체 일시 중지 상태로 시작.
 * error: 조회 실패. loading: 응답 없음. 킬 스위치는 메모리에서 실제로 켜고 끈다.
 */
export type GateScenario = 'ok' | 'empty' | 'paused' | 'error' | 'loading'
const SCENARIOS: readonly GateScenario[] = ['ok', 'empty', 'paused', 'error', 'loading']

export function parseGateScenario(search: string): GateScenario {
  const v = new URLSearchParams(search).get('mock-gate')
  return SCENARIOS.find((s) => s === v) ?? 'ok'
}

type Mock = Pick<WindowApi, 'getKillSwitch' | 'setKillSwitch' | 'getAuditSummary'>

const emptyCounts = (): AuditProjectSummary['counts'] => {
  const row = (): Record<(typeof AUDIT_RESULTS)[number], number> =>
    Object.fromEntries(AUDIT_RESULTS.map((r) => [r, 0])) as Record<
      (typeof AUDIT_RESULTS)[number],
      number
    >
  return Object.fromEntries(LIMITED_ACTIONS.map((a) => [a, row()])) as Record<
    LimitedAction,
    ReturnType<typeof row>
  >
}

function seedProject(): AuditProjectSummary {
  const counts = emptyCounts()
  counts.push.executed = 3
  counts.push['blocked-limit'] = 1
  counts.merge.executed = 1
  counts.publish['fallback-card'] = 1
  const at = (h: number, m: number): string => {
    const d = new Date()
    d.setHours(h, m, 0, 0)
    return d.toISOString()
  }
  return {
    projectId: 'my-company',
    counts,
    failures: [
      {
        at: at(14, 20),
        action: 'push',
        target: 'feature/T-053 a1b2c3d',
        result: 'blocked-limit',
        employee: 'electron-main-dev',
        ticket: 'T-053'
      },
      {
        at: at(11, 5),
        action: 'publish',
        target: 'drafts/launch.md 9f8e7d6',
        result: 'fallback-card',
        employee: 'writer',
        ticket: 'T-049'
      }
    ]
  }
}

export function createMockGateApi(
  scenario: GateScenario,
  delayMs = 0
): { api: Mock; reset: () => void } {
  const initial = (): KillSwitchState => ({
    company: scenario === 'paused',
    projects: [],
    updatedAt: null
  })
  let state = initial()
  const wait = (): Promise<void> =>
    scenario === 'loading'
      ? new Promise(() => {})
      : delayMs > 0
        ? new Promise((r) => setTimeout(r, delayMs))
        : Promise.resolve()
  const failure = { ok: false, code: 'internal', message: '실패' } as const
  const api: Mock = {
    getKillSwitch: async () => {
      await wait()
      return scenario === 'error' ? failure : { ok: true, value: structuredClone(state) }
    },
    setKillSwitch: async (req) => {
      await wait()
      if (scenario === 'error') return failure
      if (req.scope === 'company') state.company = req.engaged
      else if (req.projectId) {
        const rest = state.projects.filter((id) => id !== req.projectId)
        state.projects = req.engaged ? [...rest, req.projectId] : rest
      } else return { ok: false, code: 'invalid-request', message: '프로젝트가 필요해요' }
      state.updatedAt = new Date().toISOString()
      return { ok: true, value: structuredClone(state) }
    },
    getAuditSummary: async (req) => {
      await wait()
      if (scenario === 'error') return failure
      const summary: AuditSummary = {
        from: req.from,
        to: req.to,
        projects: scenario === 'empty' ? [] : [seedProject()]
      }
      return { ok: true, value: summary }
    }
  }
  return {
    api,
    reset: () => {
      state = initial()
    }
  }
}
