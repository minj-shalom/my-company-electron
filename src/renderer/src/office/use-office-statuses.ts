import { useEffect, useState } from 'react'
import type { OfficeStatusMap } from '../../../shared/office'
import { getOfficeStatusSource } from './status'

/** 직원 상태를 구독한다. 직원 목록이 같으면 구독을 유지하고, 언마운트하면 해제한다. */
export function useOfficeStatuses(titles: readonly string[]): OfficeStatusMap {
  const [statuses, setStatuses] = useState<OfficeStatusMap>({})
  const key = titles.join('\u0000')
  useEffect(() => {
    const list = key === '' ? [] : key.split('\u0000')
    return getOfficeStatusSource().subscribe(list, setStatuses)
  }, [key])
  return statuses
}
