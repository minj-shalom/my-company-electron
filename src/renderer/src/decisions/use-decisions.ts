import { useCallback } from 'react'
import type { Decision } from '../../../shared/decision'
import { usePolledState } from '../lib/use-polled-state'
import {
  applyResolved,
  loadDecisionState,
  mergeRefresh,
  type DecisionsState
} from './decision-view'

export interface UseDecisions {
  state: DecisionsState
  /** force: 낡은 진행 중 요청을 버리고 새로 조회한다 (처리 충돌 뒤 등). */
  refresh: (opts?: { force?: boolean }) => Promise<void>
  markResolved: (d: Decision) => void
}

const INITIAL: DecisionsState = { kind: 'loading' }
const load = (): Promise<DecisionsState> => loadDecisionState(window.api)

/** 결재함 목록과 새 카드 알림용 개수를 한 곳에서 관리한다 (앱 셸에서 호출해 탭이 닫혀 있어도 배지가 갱신된다). */
export function useDecisions(): UseDecisions {
  const { state, setState, refresh, invalidate } = usePolledState(load, mergeRefresh, INITIAL)

  const markResolved = useCallback(
    (d: Decision): void => {
      invalidate()
      setState((prev) => applyResolved(prev, d))
      // 첫 로딩 중이었다면 위 반영이 무시되고 응답도 버려졌으므로, 다음 폴링까지 로딩에 머물지 않게 바로 다시 읽는다.
      void refresh({ force: true })
    },
    [invalidate, setState, refresh]
  )

  return { state, refresh, markResolved }
}
