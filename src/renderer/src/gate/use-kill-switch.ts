import { useCallback, useEffect, useRef, useState } from 'react'
import type { KillSwitchSetRequest, KillSwitchState } from '../../../shared/gate'

export type KillSwitchLoad =
  | { kind: 'loading' }
  | { kind: 'ready'; state: KillSwitchState }
  | { kind: 'error'; message: string }

export interface UseKillSwitch {
  load: KillSwitchLoad
  busy: boolean
  /** 마지막 변경 실패 문구. 다음 시도 때 지운다. */
  error: string | null
  reload: () => void
  /** 사용자 클릭 핸들러에서만 호출한다 (해제 포함). */
  set: (req: KillSwitchSetRequest) => Promise<void>
}

export function useKillSwitch(): UseKillSwitch {
  const [load, setLoad] = useState<KillSwitchLoad>({ kind: 'loading' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const lock = useRef(false)

  useEffect(() => {
    let cancelled = false
    window.api
      .getKillSwitch()
      .then((r) => {
        if (cancelled) return
        setLoad(
          r.ok
            ? { kind: 'ready', state: r.value }
            : { kind: 'error', message: '자동 실행 상태를 읽지 못했어요' }
        )
      })
      .catch(() => {
        if (!cancelled) setLoad({ kind: 'error', message: '자동 실행 상태를 읽지 못했어요' })
      })
    return () => {
      cancelled = true
    }
  }, [tick])

  const reload = useCallback(() => {
    setLoad({ kind: 'loading' })
    setTick((n) => n + 1)
  }, [])

  const set = useCallback(async (req: KillSwitchSetRequest) => {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError(null)
    try {
      const r = await window.api.setKillSwitch(req)
      if (r.ok) setLoad({ kind: 'ready', state: r.value })
      else setError('상태를 바꾸지 못했어요. 다시 시도해 주세요')
    } catch {
      setError('상태를 바꾸지 못했어요. 다시 시도해 주세요')
    } finally {
      lock.current = false
      setBusy(false)
    }
  }, [])

  return { load, busy, error, reload, set }
}
