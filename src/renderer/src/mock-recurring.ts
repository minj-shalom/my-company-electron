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

const seed = (): RecurringDefinition[] => [
  {
    id: 'blog-daily',
    projectId: 'my-company',
    titleTemplate: '블로그 글 {date}',
    goalTemplate: '오늘의 블로그 글 초안을 쓴다.',
    criteriaTemplates: ['초안 작성', '검수 요청'],
    cadence: 'daily',
    count: 1,
    assignee: null,
    status: 'active'
  }
]

/** 브라우저 개발 모드 전용 최소 mock. 화면 시나리오는 ui-dev 단계에서 확장한다. */
export function createMockRecurringApi(): { api: Mock; reset: () => void } {
  let defs = seed()
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
      defs = seed()
    },
    api: {
      listRecurring: async () => ({
        ok: true,
        value: { items: defs.map(item), unreadable: 0, overLimit: 0 }
      }),
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
