import { useCallback, useEffect, useState } from 'react'
import { loadProjects, type ProjectsLoad } from './project-model'

export interface UseProjects {
  load: ProjectsLoad
  /** 다시 읽는 동안에도 이전 목록을 유지해 화면 위치와 포커스를 지킨다. */
  refreshing: boolean
  reload: () => void
}

export function useProjects(): UseProjects {
  const [load, setLoad] = useState<ProjectsLoad>({ kind: 'loading' })
  const [refreshing, setRefreshing] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    void loadProjects(window.api).then((next) => {
      if (cancelled) return
      setLoad(next)
      setRefreshing(false)
    })
    return () => {
      cancelled = true
    }
  }, [tick])

  const reload = useCallback(() => {
    setRefreshing(true)
    setTick((n) => n + 1)
  }, [])

  return { load, refreshing, reload }
}
