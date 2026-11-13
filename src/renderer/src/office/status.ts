import type { WindowApi } from '../../../shared/api'
import type { Decision } from '../../../shared/decision'
import type { RunEvent } from '../../../shared/run'
import type { Ticket } from '../../../shared/ticket'
import type { AvatarStatus, OfficeStatusMap, OfficeStatusSource } from '../../../shared/office'

export const STATUS_LABEL: Record<AvatarStatus, string> = {
  idle: '대기',
  working: '작업 중',
  'awaiting-approval': '승인 대기'
}

export function statusOf(map: OfficeStatusMap, title: string): AvatarStatus {
  return Object.hasOwn(map, title) ? map[title] : 'idle'
}

/** 움직임이 필요한 상태인지. 대기는 정지 표식만 쓴다. */
export function isAnimated(status: AvatarStatus): boolean {
  return status !== 'idle'
}

export function countByStatus(
  titles: readonly string[],
  map: OfficeStatusMap
): Record<AvatarStatus, number> {
  const counts: Record<AvatarStatus, number> = { idle: 0, working: 0, 'awaiting-approval': 0 }
  for (const t of titles) counts[statusOf(map, t)] += 1
  return counts
}

/** 두 상태 맵이 직원 목록 기준으로 같은지. 같으면 화면을 다시 그리지 않는다. */
export function sameStatuses(
  titles: readonly string[],
  a: OfficeStatusMap,
  b: OfficeStatusMap
): boolean {
  return titles.every((t) => statusOf(a, t) === statusOf(b, t))
}

/**
 * 티켓과 결재 카드에서 직원 상태를 정한다 (순수 함수).
 * 승인 대기(담당 티켓에 대기 중인 결재 카드)가 작업 중(담당 티켓이 진행 중)보다 우선한다.
 */
export function deriveStatuses(
  titles: readonly string[],
  agentIds: Readonly<Record<string, string | null>>,
  tickets: readonly Pick<Ticket, 'id' | 'status' | 'assignee'>[],
  pendingDecisions: readonly Pick<Decision, 'ticketId'>[]
): OfficeStatusMap {
  const awaiting = new Set(
    pendingDecisions.flatMap((d) => (d.ticketId === null ? [] : [d.ticketId]))
  )
  const working = new Set<string>()
  const approval = new Set<string>()
  for (const t of tickets) {
    if (t.assignee === null) continue
    if (awaiting.has(t.id)) approval.add(t.assignee)
    else if (t.status === 'in-progress') working.add(t.assignee)
  }
  return Object.fromEntries(
    titles.map((title): [string, AvatarStatus] => {
      const id = Object.hasOwn(agentIds, title) ? agentIds[title] : null
      if (id === null) return [title, 'idle']
      return [title, approval.has(id) ? 'awaiting-approval' : working.has(id) ? 'working' : 'idle']
    })
  )
}

/** 상태가 바뀌었을 수 있는 실행 이벤트만 다시 읽는 계기로 쓴다. */
export function isStatusTrigger(event: Pick<RunEvent, 'type'>): boolean {
  return (
    event.type === 'start' ||
    event.type === 'result' ||
    event.type === 'exit' ||
    event.type === 'error'
  )
}

export const REFRESH_MS = 15_000
export const DEBOUNCE_MS = 300

type Api = Pick<WindowApi, 'listTickets' | 'listDecisions' | 'onRunEvent'>

/**
 * `window.api`로 티켓·결재 카드를 읽어 상태를 만드는 공급자. 실행 이벤트가 오면 다시 읽고(디바운스),
 * 이벤트가 없어도 주기적으로 읽는다. 읽기에 실패하면 이전 상태를 유지한다 (깜빡이지 않게).
 * 실행 이벤트에는 직원 정보가 없어 이벤트 자체로는 직원을 정하지 못한다 (main 사양은 T-033 보고 참고).
 */
export function createLiveStatusSource(getApi: () => Api): OfficeStatusSource {
  return {
    subscribe: (titles, onChange, agentIds = {}) => {
      const api = getApi()
      let last: OfficeStatusMap | null = null
      let disposed = false
      let seq = 0
      const load = async (): Promise<void> => {
        const mine = ++seq
        try {
          const [t, d] = await Promise.all([api.listTickets(), api.listDecisions('pending')])
          // 늦게 도착한 오래된 응답은 버린다.
          if (disposed || mine !== seq) return
          const next = deriveStatuses(
            titles,
            agentIds,
            t.ok ? t.value.items : [],
            d.ok ? d.value.items : []
          )
          if (last !== null && sameStatuses(titles, last, next)) return
          last = next
          onChange(next)
        } catch {
          // 읽기 실패는 이전 상태를 유지하고 다음 주기에 다시 시도한다.
        }
      }
      void load()
      let debounce: ReturnType<typeof setTimeout> | undefined
      let unsubscribe: () => void = () => {}
      try {
        unsubscribe = api.onRunEvent((e) => {
          if (!isStatusTrigger(e)) return
          clearTimeout(debounce)
          debounce = setTimeout(() => void load(), DEBOUNCE_MS)
        })
      } catch {
        // 이벤트 구독이 없어도 주기 읽기로 동작한다.
      }
      const timer = setInterval(() => void load(), REFRESH_MS)
      return () => {
        disposed = true
        clearTimeout(debounce)
        clearInterval(timer)
        unsubscribe()
      }
    }
  }
}

let source: OfficeStatusSource = createLiveStatusSource(() => window.api)

export function getOfficeStatusSource(): OfficeStatusSource {
  return source
}

/** 개발 모드 mock 등으로 공급자를 교체한다. */
export function setOfficeStatusSource(next: OfficeStatusSource): void {
  source = next
}
