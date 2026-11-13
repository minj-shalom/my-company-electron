import { useCallback } from 'react'
import type { Ticket } from '../../../shared/ticket'
import { usePolledState } from '../lib/use-polled-state'
import { applyMoved, loadTicketState, mergeRefresh, type TicketsState } from './ticket-view'

export interface UseTickets {
  state: TicketsState
  /** force: 낡은 진행 중 요청을 버리고 새로 조회한다 (이동 충돌 뒤 등). */
  refresh: (opts?: { force?: boolean }) => Promise<void>
  markMoved: (t: Ticket) => void
}

const INITIAL: TicketsState = { kind: 'loading' }
const load = (): Promise<TicketsState> => loadTicketState(window.api)

/** 보드 목록과 조직도(담당 배지용)를 불러온다. 갱신 방식은 결재함과 같다 (임시 폴링 + 포커스 재조회). */
export function useTickets(): UseTickets {
  const { state, setState, refresh, invalidate } = usePolledState(load, mergeRefresh, INITIAL)

  const markMoved = useCallback(
    (t: Ticket): void => {
      // 이미 날아간 조회는 이동 전 상태를 담고 있으므로 버린다 (낡은 응답이 카드를 되돌리지 않게).
      invalidate()
      setState((prev) => applyMoved(prev, t))
      void refresh({ force: true })
    },
    [invalidate, setState, refresh]
  )

  return { state, refresh, markMoved }
}
