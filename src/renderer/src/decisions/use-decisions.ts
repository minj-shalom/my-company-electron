import { useCallback, useEffect, useRef, useState } from 'react'
import type { Decision } from '../../../shared/decision'
import {
  applyResolved,
  loadDecisionState,
  mergeRefresh,
  POLL_INTERVAL_MS,
  shouldRefetchOnFocus,
  type DecisionsState
} from './decision-view'

export interface UseDecisions {
  state: DecisionsState
  refresh: () => Promise<void>
  markResolved: (d: Decision) => void
}

/**
 * 결재함 목록과 새 카드 알림용 개수를 한 곳에서 관리한다 (앱 셸에서 호출해 탭이 닫혀 있어도 배지가 갱신된다).
 * 임시: main이 카드 변경 이벤트를 주기 전까지 주기적 재조회 + 창 포커스 재조회로 대신한다. 이벤트가 생기면 폴링을 제거한다.
 */
export function useDecisions(): UseDecisions {
  const [state, setState] = useState<DecisionsState>({ kind: 'loading' })
  const inflight = useRef<Promise<void> | null>(null)
  const alive = useRef(true)
  const lastAt = useRef<number | null>(null)

  const refresh = useCallback((): Promise<void> => {
    // 진행 중인 요청이 있으면 새로 보내지 않고 그 결과를 기다린다.
    if (inflight.current) return inflight.current
    const p = loadDecisionState(window.api)
      .then((next) => {
        lastAt.current = Date.now()
        if (alive.current) setState((prev) => mergeRefresh(prev, next))
      })
      .finally(() => {
        inflight.current = null
      })
    inflight.current = p
    return p
  }, [])

  useEffect(() => {
    alive.current = true
    void refresh()
    const timer = window.setInterval(() => {
      if (!document.hidden) void refresh()
    }, POLL_INTERVAL_MS)
    const onFocus = (): void => {
      if (shouldRefetchOnFocus(lastAt.current, Date.now())) void refresh()
    }
    window.addEventListener('focus', onFocus)
    return () => {
      alive.current = false
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [refresh])

  const markResolved = useCallback((d: Decision): void => {
    setState((prev) => applyResolved(prev, d))
  }, [])

  return { state, refresh, markResolved }
}
