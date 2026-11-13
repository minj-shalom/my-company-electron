import { useCallback, useEffect, useState } from 'react'
import type { VisitSummary } from '../../../shared/visit'

export type VisitLoad =
  | { kind: 'loading' }
  | { kind: 'ready'; summary: VisitSummary }
  | { kind: 'error'; message: string }
  | { kind: 'dismissed' }

const CONFIRM_ERROR = '확인 기록을 남기지 못했어요. 다시 눌러 주세요.'

/** 확인 기록 결과를 화면 상태로 바꾼다. 실패하면 배너를 닫지 않고 오류를 돌려준다. */
export async function confirmSeen(
  mark: () => Promise<{ ok: boolean }>
): Promise<{ dismissed: boolean; error: string | null }> {
  try {
    const r = await mark()
    return r.ok ? { dismissed: true, error: null } : { dismissed: false, error: CONFIRM_ERROR }
  } catch {
    return { dismissed: false, error: CONFIRM_ERROR }
  }
}

export interface UseVisitSummary {
  load: VisitLoad
  busy: boolean
  confirmError: string | null
  reload: () => void
  /** 요약을 확인했다고 기록하고 닫는다. 기록에 실패하면 닫지 않고 알린다. */
  confirm: () => Promise<void>
}

/** 앱 시작 방문 요약. 화면에 그린 뒤 사용자가 확인할 때만 마지막 방문 시각을 갱신한다. */
export function useVisitSummary(projectId: string | null): UseVisitSummary {
  const [load, setLoad] = useState<VisitLoad>({ kind: 'loading' })
  const [tick, setTick] = useState(0)
  const [busy, setBusy] = useState(false)
  const [confirmError, setConfirmError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const fail = (): void => {
      if (!cancelled) setLoad({ kind: 'error', message: '새 소식을 불러오지 못했어요' })
    }
    window.api
      .getVisitSummary(projectId ? { projectId } : undefined)
      .then((r) => {
        if (cancelled) return
        // 이미 확인해 닫았다면 필터를 바꿔도 다시 열지 않는다.
        if (r.ok)
          setLoad((cur) => (cur.kind === 'dismissed' ? cur : { kind: 'ready', summary: r.value }))
        else fail()
      })
      .catch(fail)
    return () => {
      cancelled = true
    }
  }, [projectId, tick])

  const reload = useCallback(() => {
    setLoad({ kind: 'loading' })
    setTick((n) => n + 1)
  }, [])

  const confirm = useCallback(async () => {
    setBusy(true)
    setConfirmError(null)
    try {
      const r = await confirmSeen(() => window.api.markVisitSeen())
      if (r.dismissed) setLoad({ kind: 'dismissed' })
      else setConfirmError(r.error)
    } finally {
      setBusy(false)
    }
  }, [])

  return { load, busy, confirmError, reload, confirm }
}
