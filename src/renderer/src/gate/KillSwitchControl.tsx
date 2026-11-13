import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { killSwitchView } from './gate-model'
import type { UseKillSwitch } from './use-kill-switch'

/** 상태바의 킬 스위치. 중지는 확인 없이 즉시, 재개는 이 버튼을 직접 누를 때만 한다. */
export function KillSwitchControl({
  ks,
  autoProjectCount
}: {
  ks: UseKillSwitch
  autoProjectCount: number
}): React.JSX.Element {
  const { load } = ks
  if (load.kind === 'loading') return <span className="hint">자동 실행 상태 확인 중…</span>
  if (load.kind === 'error')
    return (
      <span className="killswitch">
        <span role="alert" className="error">
          {load.message}
        </span>
        <Button size="small" onClick={ks.reload}>
          다시 시도
        </Button>
      </span>
    )
  const view = killSwitchView(load.state, autoProjectCount)
  return (
    <span className="killswitch" data-paused={view.paused}>
      {view.badge && (
        <Badge tone={view.badge.tone}>
          <span role="status">{view.badge.label}</span>
        </Badge>
      )}
      <Button
        size="small"
        variant={view.paused ? 'primary' : 'default'}
        aria-disabled={ks.busy}
        onClick={() => !ks.busy && void ks.set({ scope: 'company', engaged: !view.paused })}
      >
        {view.buttonLabel}
      </Button>
      {ks.error && (
        <span role="alert" className="error">
          {ks.error}
        </span>
      )}
    </span>
  )
}
