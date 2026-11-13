import type { WindowApi } from '../../shared/api'
import {
  MAX_RECURRING_DEFS,
  type RecurringDefinition,
  type RecurringItem
} from '../../shared/recurring'

type Mock = Pick<
  WindowApi,
  'listRecurring' | 'addRecurring' | 'updateRecurring' | 'setRecurringStatus' | 'removeRecurring'
>

const DAY_MS = 86_400_000

/**
 * 시나리오(`?mock-recurring=`): ok, empty, error, loading(영원히 대기), issues(읽지 못한 정의와 상한 초과 안내).
 * 개발 서버에서만 쓰이는 mock이다.
 */
export type RecurringScenario = 'ok' | 'empty' | 'error' | 'loading' | 'issues'
const SCENARIOS: readonly RecurringScenario[] = ['ok', 'empty', 'error', 'loading', 'issues']

export function parseRecurringScenario(search: string): RecurringScenario {
  const v = new URLSearchParams(search).get('mock-recurring')
  return SCENARIOS.find((s) => s === v) ?? 'ok'
}

const seed = (scenario: RecurringScenario = 'ok'): RecurringDefinition[] =>
  scenario === 'empty' ? [] : baseSeed()

const baseSeed = (): RecurringDefinition[] => [
  {
    id: 'blog-daily',
    projectId: 'blog',
    titleTemplate: '블로그 글 {date}',
    goalTemplate: '오늘의 블로그 글 초안을 쓴다.',
    criteriaTemplates: ['초안 작성', '검수 요청'],
    cadence: 'daily',
    count: 1,
    assignee: null,
    status: 'active'
  },
  {
    id: 'weekday-report',
    projectId: 'my-company',
    titleTemplate: '일일 점검 {date}',
    goalTemplate: '어제 변경 사항을 점검한다.',
    criteriaTemplates: ['점검 결과 정리'],
    cadence: 'weekdays',
    count: 1,
    assignee: 'developer',
    status: 'active'
  },
  {
    id: 'weekly-review',
    projectId: 'my-company',
    titleTemplate: '주간 회고 {date}',
    goalTemplate: '한 주를 돌아본다.',
    criteriaTemplates: ['잘한 점', '개선할 점'],
    cadence: 'weekly:금',
    count: 1,
    assignee: null,
    status: 'paused'
  },
  {
    id: 'landing-news',
    projectId: 'landing',
    titleTemplate: '소식 글 {date}',
    goalTemplate: '랜딩 페이지 소식을 하나 쓴다.',
    criteriaTemplates: ['초안 작성'],
    cadence: 'daily',
    count: 1,
    assignee: null,
    status: 'active'
  }
]

export function createMockRecurringApi(scenario: RecurringScenario = 'ok'): {
  api: Mock
  reset: () => void
} {
  let defs = seed(scenario)
  const item = (d: RecurringDefinition): RecurringItem => ({
    ...structuredClone(d),
    createdToday: false,
    nextRunAt: d.status === 'paused' ? null : Date.now() + DAY_MS
  })
  const find = (id: string): number => defs.findIndex((d) => d.id === id)
  const notFound = {
    ok: false,
    code: 'not-found',
    message: '반복 업무를 찾을 수 없습니다.'
  } as const
  return {
    reset: () => {
      defs = seed(scenario)
    },
    api: {
      listRecurring: async () => {
        if (scenario === 'loading') return new Promise(() => {})
        if (scenario === 'error')
          return { ok: false, code: 'internal', message: 'mock internal error' }
        const issues = scenario === 'issues'
        return {
          ok: true,
          value: { items: defs.map(item), unreadable: issues ? 2 : 0, overLimit: issues ? 3 : 0 }
        }
      },
      addRecurring: async (req) => {
        if (find(req.id) >= 0)
          return { ok: false, code: 'conflict', message: '같은 id의 반복 업무가 이미 있습니다.' }
        if (defs.length >= MAX_RECURRING_DEFS)
          return { ok: false, code: 'invalid-request', message: '반복 업무가 너무 많습니다.' }
        defs.push(structuredClone(req))
        return { ok: true, value: structuredClone(req) }
      },
      updateRecurring: async (req) => {
        const at = find(req.id)
        if (at < 0) return notFound
        defs[at] = structuredClone(req)
        return { ok: true, value: structuredClone(req) }
      },
      setRecurringStatus: async (req) => {
        const at = find(req.id)
        if (at < 0) return notFound
        defs[at] = { ...defs[at], status: req.status }
        return { ok: true, value: structuredClone(defs[at]) }
      },
      removeRecurring: async (req) => {
        const at = find(req.id)
        if (at < 0) return notFound
        defs.splice(at, 1)
        return { ok: true, value: { id: req.id } }
      }
    }
  }
}
