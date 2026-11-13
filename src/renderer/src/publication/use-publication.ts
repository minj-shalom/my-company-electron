import { useCallback, useEffect, useState } from 'react'
import { loadDrafts, type DraftsLoad } from './publication-model'

export interface UsePublication {
  load: DraftsLoad
  refreshing: boolean
  reload: () => void
}

/** 프로젝트가 바뀌면 이전 프로젝트의 목록은 버리고 다시 읽는다. */
export function usePublication(projectId: string | null): UsePublication {
  const [loaded, setLoaded] = useState<DraftsLoad>({ kind: 'loading' })
  const [refreshing, setRefreshing] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (projectId === null) return
    let cancelled = false
    void loadDrafts(window.api, projectId).then((next) => {
      if (cancelled) return
      setLoaded(next)
      setRefreshing(false)
    })
    return () => {
      cancelled = true
    }
  }, [projectId, tick])

  const reload = useCallback(() => {
    setRefreshing(true)
    setTick((n) => n + 1)
  }, [])

  // 다른 프로젝트의 낡은 결과는 로딩으로 취급한다.
  const stale = loaded.kind === 'ready' && loaded.projectId !== projectId
  return { load: stale ? { kind: 'loading' } : loaded, refreshing, reload }
}
