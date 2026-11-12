import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Decision } from '../../../shared/decision'
import {
  applyResolved,
  createRefreshGuard,
  loadDecisionState,
  mergeRefresh,
  POLL_INTERVAL_MS,
  shouldRefetchOnFocus,
  type DecisionsState
} from './decision-view'

export interface UseDecisions {
  state: DecisionsState
  /** force: 낡은 진행 중 요청을 버리고 새로 조회한다 (처리 충돌 뒤 등). */
  refresh: (opts?: { force?: boolean }) => Promise<void>
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

  const guard = useMemo(() => createRefreshGuard(), [])

  const refresh = useCallback(
    (opts?: { force?: boolean }): Promise<void> => {
      if (opts?.force) {
        guard.invalidate()
        inflight.current = null
      }
      // 진행 중인 요청이 있으면 새로 보내지 않고 그 결과를 기다린다.
      if (inflight.current) return inflight.current
      const token = guard.begin()
      const p: Promise<void> = loadDecisionState(window.api)
        .then((next) => {
          if (!alive.current || !guard.isCurrent(token)) return
          lastAt.current = Date.now()
          setState((prev) => mergeRefresh(prev, next))
        })
        .finally(() => {
          if (inflight.current === p) inflight.current = null
        })
      inflight.current = p
      return p
    },
    [guard]
  )

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

  const markResolved = useCallback(
    (d: Decision): void => {
      // 이미 날아간 조회는 처리 전 상태를 담고 있으므로 버린다.
      guard.invalidate()
      inflight.current = null
      setState((prev) => applyResolved(prev, d))
      // 첫 로딩 중이었다면 위 반영이 무시되고 응답도 버려졌으므로, 다음 폴링까지 로딩에 머물지 않게 바로 다시 읽는다.
      void refresh({ force: true })
    },
    [guard, refresh]
  )

  return { state, refresh, markResolved }
}
