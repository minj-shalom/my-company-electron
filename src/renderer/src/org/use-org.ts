import { useCallback, useEffect, useState } from 'react'
import { loadOrgStatus, type OrgStatus } from './org-view'

/**
 * 마운트 시 조직도를 불러오고, refresh로 다시 읽는다.
 * 다시 읽는 동안에도 이전 status를 유지해 화면의 선택과 포커스가 사라지지 않게 한다 (`refreshing`으로만 표시).
 */
export function useOrg(): { status: OrgStatus; refreshing: boolean; refresh: () => void } {
  const [status, setStatus] = useState<OrgStatus>({ kind: 'loading' })
  const [refreshing, setRefreshing] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    void loadOrgStatus(window.api).then((next) => {
      if (cancelled) return
      setStatus(next)
      setRefreshing(false)
    })
    return () => {
      cancelled = true
    }
  }, [tick])

  const refresh = useCallback(() => {
    setRefreshing(true)
    setTick((n) => n + 1)
  }, [])

  return { status, refreshing, refresh }
}
