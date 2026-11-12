import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createRefreshGuard,
  POLL_INTERVAL_MS,
  shouldRefetchOnFocus,
  type RefreshGuard
} from './refresh'

export interface PolledState<S> {
  state: S
  setState: React.Dispatch<React.SetStateAction<S>>
  /** force: 낡은 진행 중 요청을 버리고 새로 조회한다 (처리 충돌 뒤 등). */
  refresh: (opts?: { force?: boolean }) => Promise<void>
  /** 쓰기 직후 호출한다. 이미 날아간 조회는 쓰기 전 상태를 담고 있으므로 응답을 버리게 한다. */
  invalidate: () => void
  guard: RefreshGuard
}

/**
 * 첫 로딩, 중복 요청 합치기, 세대 가드, 언마운트 가드를 갖춘 조회 상태.
 * 임시: main이 변경 이벤트를 주기 전까지 주기적 재조회 + 창 포커스 재조회로 대신한다. 이벤트가 생기면 폴링을 제거한다.
 * load는 참조가 안정적이어야 한다 (모듈 수준 함수나 useCallback).
 */
export function usePolledState<S>(
  load: () => Promise<S>,
  merge: (prev: S, next: S) => S,
  initial: S
): PolledState<S> {
  const [state, setState] = useState<S>(initial)
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
      const p: Promise<void> = load()
        .then((next) => {
          if (!alive.current || !guard.isCurrent(token)) return
          lastAt.current = Date.now()
          setState((prev) => merge(prev, next))
        })
        .finally(() => {
          if (inflight.current === p) inflight.current = null
        })
      inflight.current = p
      return p
    },
    [guard, load, merge]
  )

  const invalidate = useCallback((): void => {
    guard.invalidate()
    inflight.current = null
  }, [guard])

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

  return { state, setState, refresh, invalidate, guard }
}
