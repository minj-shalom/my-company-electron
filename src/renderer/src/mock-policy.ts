import type { WindowApi } from '../../shared/api'
import {
  LIMITED_ACTIONS,
  MAX_DAILY_LIMIT,
  PROTECTED_MERGE_MAX_DAILY,
  type EffectivePolicy,
  type PolicyAction,
  type PolicyHistoryEntry,
  type PolicyState,
  type PolicySummary,
  type PolicyValues,
  type PolicyViolation,
  type PolicyWarning
} from '../../shared/policy'
import type { ApiResult } from '../../shared/result'
import { hasProtectedTarget } from './policy/policy-model'

/**
 * 브라우저 개발 모드 전용. `?mock-policy=ok|empty|warnings|conflict|error|loading|slow`.
 * ok: my-company는 자동 푸시가 켜진 정책(이력 포함), 나머지는 파일 없음. empty: 모두 파일 없음.
 * warnings: 경고가 있는 정책. conflict: 첫 저장이 충돌. error: 조회 실패. loading: 응답 없음. slow: 응답 지연.
 * 서버 규칙(확인 필요, 상한, 허용 대상, 보호 브랜치 이름 확인)을 흉내 내 위반 코드를 돌려준다.
 */
export type PolicyScenario = 'ok' | 'empty' | 'warnings' | 'conflict' | 'error' | 'loading' | 'slow'
const SCENARIOS: readonly PolicyScenario[] = [
  'ok',
  'empty',
  'warnings',
  'conflict',
  'error',
  'loading',
  'slow'
]

export function parsePolicyScenario(search: string): PolicyScenario {
  const v = new URLSearchParams(search).get('mock-policy')
  return SCENARIOS.find((s) => s === v) ?? 'ok'
}

type Mock = Pick<WindowApi, 'getPolicy' | 'savePolicy' | 'listPolicySummaries'>

const defaults = (): PolicyValues => ({
  flow: 'dev-git-pr',
  modes: { push: 'every', merge: 'every', publish: 'every', 'draft-approve': 'every' },
  dailyLimits: {},
  autoPushPrefixes: [],
  autoMergeBranches: [],
  confirmInput: null,
  branchPrefix: 'feature/',
  baseBranch: 'develop',
  usePr: true,
  reviewStage: 'required',
  dailyOutputGoal: 0,
  outputDir: 'drafts/',
  publishAdapter: 'manual',
  activeHours: null,
  memo: null
})

interface Stored {
  values: PolicyValues
  history: PolicyHistoryEntry[]
  warnings: PolicyWarning[]
  rev: number
  activated: boolean
}

const effectiveOf = (v: PolicyValues, activated: boolean): EffectivePolicy => {
  const modes = { ...v.modes }
  const dailyLimits: EffectivePolicy['dailyLimits'] = {}
  for (const a of LIMITED_ACTIONS) {
    if (modes[a] === 'auto' && (!activated || v.dailyLimits[a] === undefined)) modes[a] = 'every'
    else if (modes[a] === 'auto') dailyLimits[a] = v.dailyLimits[a]
  }
  return {
    flow: v.flow,
    modes,
    dailyLimits,
    autoPushPrefixes: v.autoPushPrefixes,
    autoMergeBranches: v.autoMergeBranches,
    protectedMergeEnabled: modes.merge === 'auto' && hasProtectedTarget(v.autoMergeBranches),
    usePr: v.usePr,
    reviewStage: v.reviewStage
  }
}

function violationsOf(
  v: PolicyValues,
  name: string,
  confirmAuto: boolean,
  autoChanged: boolean
): PolicyViolation[] {
  const out: PolicyViolation[] = []
  const add = (code: PolicyViolation['code']): number => out.push({ code, message: 'server' })
  if (autoChanged && !confirmAuto) add('auto-needs-confirm')
  for (const a of LIMITED_ACTIONS) {
    if (v.modes[a] !== 'auto') continue
    const limit = v.dailyLimits[a]
    if (limit === undefined) add('auto-limit-missing')
    else if (limit > MAX_DAILY_LIMIT[a] || limit < 1) add('auto-limit-exceeded')
  }
  if (v.modes.push === 'auto' && v.autoPushPrefixes.length === 0) add('auto-target-missing')
  if (v.modes.push === 'auto' && v.autoPushPrefixes.some((p) => hasProtectedTarget([p])))
    add('auto-target-invalid')
  if (v.modes.merge === 'auto') {
    if (v.autoMergeBranches.length === 0) add('auto-target-missing')
    if (!v.usePr || v.reviewStage !== 'required') add('auto-requirement-missing')
    if (hasProtectedTarget(v.autoMergeBranches)) {
      if (v.confirmInput !== name) add('protected-merge-unconfirmed')
      if ((v.dailyLimits.merge ?? 0) > PROTECTED_MERGE_MAX_DAILY) add('protected-limit-exceeded')
    }
  }
  return out
}

const changedAuto = (prev: PolicyValues, next: PolicyValues): boolean =>
  (Object.keys(next.modes) as PolicyAction[]).some(
    (a) =>
      next.modes[a] === 'auto' &&
      (prev.modes[a] !== 'auto' || JSON.stringify(prev) !== JSON.stringify(next))
  )

function seed(s: PolicyScenario): Map<string, Stored> {
  const map = new Map<string, Stored>()
  if (s === 'empty') return map
  const v = defaults()
  v.modes.push = 'auto'
  v.dailyLimits.push = 20
  v.autoPushPrefixes = ['feature/']
  v.memo = '개발 프로젝트 기본 정책'
  map.set('my-company', {
    values: v,
    activated: true,
    rev: 3,
    warnings: [],
    history: [
      {
        at: '2026-11-10T09:00:00.000Z',
        actor: '제안 D-021',
        summary: '정책 파일 생성 (모든 동작 매번 컨펌)'
      },
      {
        at: '2026-11-12T14:30:00.000Z',
        actor: 'CEO 직접',
        summary: '푸시 자동 켬 (하루 20회, feature/)'
      }
    ]
  })
  if (s === 'warnings') {
    const w = defaults()
    w.modes.merge = 'auto'
    map.set('landing', {
      values: w,
      activated: false,
      rev: 1,
      warnings: [
        { code: 'auto-not-activated', message: 'x' },
        { code: 'auto-limit-missing', field: '머지', message: 'x' },
        { code: 'immutable-relaxed', message: 'x' }
      ],
      history: []
    })
  }
  return map
}

export function createMockPolicyApi(
  scenario: PolicyScenario,
  delayMs: number,
  projects: () => Promise<{ id: string; name: string }[]>
): { api: Mock; reset: () => void } {
  let store = seed(scenario)
  let conflictPending = scenario === 'conflict'
  const wait = (): Promise<void> =>
    new Promise((r) => setTimeout(r, scenario === 'slow' ? Math.max(delayMs, 1) * 5 : delayMs))
  const find = async (id: string): Promise<{ id: string; name: string } | null> =>
    (await projects()).find((p) => p.id === id) ?? null
  const stateOf = (id: string): PolicyState => {
    const s = store.get(id)
    const values = s?.values ?? defaults()
    return {
      projectId: id,
      exists: s !== undefined,
      revision: String(s?.rev ?? 0),
      values: structuredClone(values),
      effective: effectiveOf(values, s?.activated ?? false),
      activation: s?.activated ? { at: '2026-11-12T14:30:00.000Z', by: 'ceo-ui' } : null,
      warnings: structuredClone(s?.warnings ?? []),
      history: structuredClone(s?.history ?? [])
    }
  }
  const nf = (): ApiResult<never> => ({ ok: false, code: 'not-found', message: 'x' })

  return {
    reset: () => {
      store = seed(scenario)
      conflictPending = scenario === 'conflict'
    },
    api: {
      getPolicy: async ({ projectId }) => {
        if (scenario === 'loading') return new Promise(() => {})
        await wait()
        if (scenario === 'error') return { ok: false, code: 'internal', message: 'x' }
        return (await find(projectId)) ? { ok: true, value: stateOf(projectId) } : nf()
      },
      savePolicy: async ({ projectId, revision, values, confirmAuto }) => {
        await wait()
        const proj = await find(projectId)
        if (!proj) return nf()
        const cur = store.get(projectId)
        if (conflictPending) {
          conflictPending = false
          return { ok: false, code: 'conflict', message: 'x' }
        }
        if (revision !== String(cur?.rev ?? 0)) return { ok: false, code: 'conflict', message: 'x' }
        const prev = cur?.values ?? defaults()
        const violations = violationsOf(
          values,
          proj.name,
          confirmAuto === true,
          changedAuto(prev, values)
        )
        if (violations.length > 0) return { ok: true, value: { saved: false, violations } }
        const turnedOn = (Object.keys(values.modes) as PolicyAction[]).filter(
          (a) => values.modes[a] === 'auto' && prev.modes[a] !== 'auto'
        )
        const turnedOff = (Object.keys(values.modes) as PolicyAction[]).filter(
          (a) => values.modes[a] !== 'auto' && prev.modes[a] === 'auto'
        )
        const label: Record<PolicyAction, string> = {
          push: '푸시',
          merge: '머지',
          publish: '발행',
          'draft-approve': '초안 승인'
        }
        const notes = [
          ...turnedOn.map((a) => `${label[a]} 자동 켬`),
          ...turnedOff.map((a) => `${label[a]} 자동 끔`)
        ]
        if (hasProtectedTarget(values.autoMergeBranches) && values.modes.merge === 'auto')
          notes.push('보호 브랜치 머지, 프로젝트 이름 입력 확인')
        const history = [
          ...(cur?.history ?? []),
          {
            at: new Date().toISOString(),
            actor: 'CEO 직접',
            summary: notes.length > 0 ? notes.join(', ') : '정책 값 변경'
          }
        ]
        store.set(projectId, {
          values: structuredClone(values),
          history,
          warnings: [],
          rev: (cur?.rev ?? 0) + 1,
          activated: cur?.activated === true || turnedOn.length > 0
        })
        return { ok: true, value: { saved: true, state: stateOf(projectId) } }
      },
      listPolicySummaries: async () => {
        await wait()
        if (scenario === 'error') return { ok: false, code: 'internal', message: 'x' }
        const list: PolicySummary[] = (await projects()).map((p) => {
          const st = store.get(p.id)
          const eff = effectiveOf(st?.values ?? defaults(), st?.activated ?? false)
          return {
            projectId: p.id,
            exists: st !== undefined,
            autoActions: (Object.keys(eff.modes) as PolicyAction[]).filter(
              (a) => eff.modes[a] === 'auto'
            ),
            protectedMergeEnabled: eff.protectedMergeEnabled,
            warningCount: st?.warnings.length ?? 0
          }
        })
        return { ok: true, value: list }
      }
    }
  }
}
