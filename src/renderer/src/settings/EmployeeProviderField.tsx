import { useEffect, useId, useState } from 'react'
import {
  PROVIDER_CLI_IDS,
  type ProviderCliId,
  type ProviderDetection
} from '../../../shared/provider'
import type { ProviderSelection } from '../../../shared/provider-selection'
import { isProviderCliIdValue } from '../../../shared/provider-selection'
import { providerBadge } from '../onboarding/detection-view'
import { loadDetection } from '../onboarding/use-detection'
import { Badge } from '../ui/Badge'
import { PROVIDER_NAMES } from './limit-wording'
import { EFFECTIVE_NOTE, effectiveProvider, setEmployeeProvider } from './settings-model'

const FOLLOW_DEFAULT = 'default'

type Load =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; selection: ProviderSelection; detections: ProviderDetection[] | null }

/** 직원 상세의 제공자 지정. "회사 기본"을 고르면 지정을 지운다. 변경은 다음 실행부터 적용된다. */
export function EmployeeProviderField({ employeeId }: { employeeId: string }): React.JSX.Element {
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const id = useId()

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [sel, det] = await Promise.all([
          window.api.getProviderSelection(),
          loadDetection(window.api)
        ])
        if (cancelled) return
        setLoad(
          sel.ok
            ? {
                kind: 'ready',
                selection: sel.value,
                detections: det.kind === 'ready' ? det.items : null
              }
            : { kind: 'error' }
        )
      } catch {
        if (!cancelled) setLoad({ kind: 'error' })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [employeeId])

  if (load.kind === 'loading') return <p className="hint">제공자 설정을 불러오고 있어요…</p>
  if (load.kind === 'error') {
    return (
      <p role="alert" className="error">
        제공자 설정을 불러오지 못했어요. 직원을 다시 선택해 주세요.
      </p>
    )
  }

  const { selection, detections } = load
  const own = selection.overrides[employeeId]
  const value = isProviderCliIdValue(own) ? own : FOLLOW_DEFAULT
  const effective = effectiveProvider(selection, employeeId)
  const det = detections?.find((d) => d.provider === effective) ?? null
  const badge = providerBadge(det, false)

  const change = async (next: string): Promise<void> => {
    const provider: ProviderCliId | null = isProviderCliIdValue(next) ? next : null
    setSaving(true)
    const r = await setEmployeeProvider(window.api, employeeId, provider)
    setSaving(false)
    if (r.ok) {
      setLoad({ ...load, selection: r.value })
      setMessage({ kind: 'ok', text: `저장했어요. ${EFFECTIVE_NOTE}` })
    } else {
      setMessage({ kind: 'error', text: '저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.' })
    }
  }

  return (
    <div className="field employee-provider">
      <label htmlFor={id}>AI 제공자</label>
      <div className="field__row">
        <select
          id={id}
          className="input"
          value={value}
          disabled={saving}
          onChange={(e) => void change(e.target.value)}
        >
          <option value={FOLLOW_DEFAULT}>
            회사 기본 ({PROVIDER_NAMES[selection.defaultProvider]})
          </option>
          {PROVIDER_CLI_IDS.map((p) => (
            <option key={p} value={p}>
              {PROVIDER_NAMES[p]}
            </option>
          ))}
        </select>
        <Badge tone={badge.tone}>
          {PROVIDER_NAMES[effective]}: {badge.label}
        </Badge>
      </div>
      <p className="hint">{EFFECTIVE_NOTE}</p>
      <div role="status" aria-live="polite">
        {message && <p className={message.kind === 'error' ? 'error' : 'hint'}>{message.text}</p>}
      </div>
    </div>
  )
}
