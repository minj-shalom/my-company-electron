import { useCallback, useEffect, useState } from 'react'
import { startSubscription } from './run-log-controller'
import { applyEvents, EMPTY_STATE, showEarlier, type RunLogState } from './run-log-model'

export type RunLogView =
  { kind: 'connecting' } | { kind: 'error' } | { kind: 'ready'; log: RunLogState }

export interface UseRunLog {
  view: RunLogView
  retry: () => void
  more: (runId: string) => void
}

/**
 * run 이벤트를 구독해 실행별 로그로 쌓는다. AppShell에 두어 다른 탭을 보는 동안에도 이벤트를 놓치지 않는다.
 * 이벤트는 프레임당 한 번만 반영하고, 해제/언마운트 뒤에는 상태를 바꾸지 않는다.
 */
export function useRunLog(): UseRunLog {
  const [view, setView] = useState<RunLogView>({ kind: 'connecting' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const sub = startSubscription(
      (listener) => window.api.onRunEvent(listener),
      (batch) =>
        setView((v) =>
          v.kind === 'ready' ? { kind: 'ready', log: applyEvents(v.log, batch) } : v
        ),
      (cb) => requestAnimationFrame(cb),
      (id) => cancelAnimationFrame(id)
    )
    // 구독은 동기 호출이라 연결 결과(성공/실패)를 여기서 한 번만 반영한다. 구독 자체가 외부 시스템과의 동기화다.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setView((v) =>
      sub.failed ? { kind: 'error' } : v.kind === 'ready' ? v : { kind: 'ready', log: EMPTY_STATE }
    )
    return sub.dispose
  }, [attempt])

  const retry = useCallback(() => {
    setView({ kind: 'connecting' })
    setAttempt((n) => n + 1)
  }, [])
  const more = useCallback((runId: string) => {
    setView((v) => (v.kind === 'ready' ? { kind: 'ready', log: showEarlier(v.log, runId) } : v))
  }, [])

  return { view, retry, more }
}
