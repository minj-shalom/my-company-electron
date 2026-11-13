import { useEffect, useMemo, useState } from 'react'
import type { OfficeStatusMap } from '../../../shared/office'
import type { OrgMember } from '../../../shared/org'
import { getOfficeStatusSource } from './status'

/** 직급 -> 에이전트 id. 티켓의 담당자 id와 대조하는 데 쓴다. */
export function agentIdsByTitle(members: readonly OrgMember[]): Record<string, string | null> {
  return Object.fromEntries(members.map((m) => [m.title, m.agentId]))
}

/** 직원 상태를 구독한다. 직원 목록이 같으면 구독을 유지하고, 언마운트하면 해제한다. */
export function useOfficeStatuses(
  titles: readonly string[],
  agentIds: Readonly<Record<string, string | null>>
): OfficeStatusMap {
  const [statuses, setStatuses] = useState<OfficeStatusMap>({})
  const key = titles.join('\u0000')
  const idsKey = JSON.stringify(titles.map((t) => agentIds[t] ?? null))
  const stableIds = useMemo(
    () => agentIds,
    // 직급 순서와 id가 같으면 같은 구독을 유지한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [idsKey]
  )
  useEffect(() => {
    const list = key === '' ? [] : key.split('\u0000')
    return getOfficeStatusSource().subscribe(list, setStatuses, stableIds)
  }, [key, stableIds])
  return statuses
}
