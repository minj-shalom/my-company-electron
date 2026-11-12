import { useCallback, useEffect, useState } from 'react'
import { loadOrgStatus, type OrgStatus } from './org-view'

/** 마운트 시 조직도를 불러오고, refresh로 다시 읽는다. */
export function useOrg(): { status: OrgStatus; refresh: () => void } {
  const [status, setStatus] = useState<OrgStatus>({ kind: 'loading' })
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    void loadOrgStatus(window.api).then((next) => {
      if (!cancelled) setStatus(next)
    })
    return () => {
      cancelled = true
    }
  }, [tick])

  const refresh = useCallback(() => {
    setStatus({ kind: 'loading' })
    setTick((n) => n + 1)
  }, [])

  return { status, refresh }
}
