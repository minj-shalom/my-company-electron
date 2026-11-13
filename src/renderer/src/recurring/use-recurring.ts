import { useCallback, useEffect, useState } from 'react'
import { loadRecurring, type RecurringLoad } from './recurring-model'

export interface UseRecurring {
  load: RecurringLoad
  /** 프로젝트별 일일 산출 목표. 못 읽은 프로젝트는 없음(0)으로 본다. */
  goals: ReadonlyMap<string, number>
  /** 이 목록을 읽은 시각(epoch ms). 렌더 중에 시계를 읽지 않으려고 읽을 때 함께 잡는다. */
  now: number
  refreshing: boolean
  reload: () => void
}

export function useRecurring(): UseRecurring {
  const [load, setLoad] = useState<RecurringLoad>({ kind: 'loading' })
  const [goals, setGoals] = useState<ReadonlyMap<string, number>>(new Map())
  const [now, setNow] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const next = await loadRecurring(window.api)
      const found = new Map<string, number>()
      if (next.kind === 'ready') {
        const ids = [...new Set(next.list.items.map((i) => i.projectId))]
        await Promise.all(
          ids.map(async (projectId) => {
            try {
              const r = await window.api.getPolicy({ projectId })
              if (r.ok) found.set(projectId, r.value.values.dailyOutputGoal)
            } catch {
              // 목표를 못 읽어도 목록은 보여 준다.
            }
          })
        )
      }
      if (cancelled) return
      setLoad(next)
      setGoals(found)
      setNow(Date.now())
      setRefreshing(false)
    })()
    return () => {
      cancelled = true
    }
  }, [tick])

  const reload = useCallback(() => {
    setRefreshing(true)
    setTick((n) => n + 1)
  }, [])

  return { load, goals, now, refreshing, reload }
}
