import { useEffect, useState } from 'react'
import { Panel } from '../ui/Panel'

type Load = { kind: 'loading' } | { kind: 'ready'; enabled: boolean } | { kind: 'error' }

/** 창이 비활성일 때 새 결재 요청을 알림으로 받을지. 알림에는 제목과 건수만 담겨요. */
export function VisitNotifySection(): React.JSX.Element {
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    window.api
      .getVisitNotify()
      .then((r) => {
        if (!cancelled)
          setLoad(r.ok ? { kind: 'ready', enabled: r.value.enabled } : { kind: 'error' })
      })
      .catch(() => {
        if (!cancelled) setLoad({ kind: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [])

  const toggle = async (enabled: boolean): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const r = await window.api.setVisitNotify({ enabled })
      if (r.ok) setLoad({ kind: 'ready', enabled: r.value.enabled })
      else setError('바꾸지 못했어요. 다시 시도해 주세요.')
    } catch {
      setError('바꾸지 못했어요. 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel title="알림">
      {load.kind === 'loading' && <p className="hint">알림 설정을 불러오고 있어요…</p>}
      {load.kind === 'error' && (
        <p role="alert" className="error">
          알림 설정을 읽지 못했어요.
        </p>
      )}
      {load.kind === 'ready' && (
        <label className="visit-notify__check">
          <input
            type="checkbox"
            checked={load.enabled}
            disabled={busy}
            onChange={(e) => void toggle(e.target.checked)}
          />
          <span>새 결재 요청이 오면 알려 주기</span>
        </label>
      )}
      <p className="hint">앱 창을 보고 있지 않을 때만 알려요. 알림에는 제목과 건수만 나와요.</p>
      <div role="status" aria-live="polite">
        {error && <p className="error">{error}</p>}
      </div>
    </Panel>
  )
}
