import { useCallback, useEffect, useState } from 'react'
import type { AuditSummary } from '../../../shared/gate'
import { todayRange } from './gate-model'

export type AuditLoad =
  | { kind: 'loading' }
  | { kind: 'ready'; summary: AuditSummary }
  | { kind: 'error'; message: string }

/** 오늘 하루의 자동 실행 감사 요약. 읽기 전용이다. */
export function useAuditSummary(): { load: AuditLoad; reload: () => void } {
  const [load, setLoad] = useState<AuditLoad>({ kind: 'loading' })
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    const fail = (): void => {
      if (!cancelled) setLoad({ kind: 'error', message: '자동 실행 기록을 읽지 못했어요' })
    }
    window.api
      .getAuditSummary(todayRange(new Date()))
      .then((r) => {
        if (cancelled) return
        if (r.ok) setLoad({ kind: 'ready', summary: r.value })
        else fail()
      })
      .catch(fail)
    return () => {
      cancelled = true
    }
  }, [tick])

  const reload = useCallback(() => {
    setLoad({ kind: 'loading' })
    setTick((n) => n + 1)
  }, [])
  return { load, reload }
}
