import { useState } from 'react'
import type { UsageSettings } from '../../../shared/usage'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Panel } from '../ui/Panel'
import { WEEKDAY_LABELS, formatReset, parseKrwPerUsd, parseWarnPercent } from './settings-model'

const HOURS = Array.from({ length: 24 }, (_, i) => i)

/** 경고 기준, 환율, 초기화 요일·시각. 저장은 전체 교체이고 환율은 네트워크로 조회하지 않는다. */
export function PrefsSection({
  settings,
  onSaved
}: {
  settings: UsageSettings
  onSaved: () => void
}): React.JSX.Element {
  const [warn, setWarn] = useState(String(settings.warnPercent))
  const [krw, setKrw] = useState(String(settings.krwPerUsd))
  const [weekday, setWeekday] = useState(settings.resetWeekday)
  const [hour, setHour] = useState(settings.resetHour)
  const [errors, setErrors] = useState<{ warn?: string; krw?: string }>({})
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const submit = async (e: React.SyntheticEvent): Promise<void> => {
    e.preventDefault()
    const w = parseWarnPercent(warn)
    const k = parseKrwPerUsd(krw)
    const next = { warn: w.ok ? undefined : w.message, krw: k.ok ? undefined : k.message }
    setErrors(next)
    if (!w.ok || !k.ok) {
      document.getElementById(w.ok ? 'settings-krw' : 'settings-warn')?.focus()
      return
    }
    setSaving(true)
    const value: UsageSettings = {
      warnPercent: w.value,
      krwPerUsd: k.value,
      resetWeekday: weekday,
      resetHour: hour
    }
    try {
      const r = await window.api.saveUsageSettings(value)
      if (r.ok) {
        setMessage({
          kind: 'ok',
          text: `저장했어요. 이제 ${r.value.warnPercent}%에 가까워지면 알려 드려요. 초기화는 ${formatReset(r.value)}예요.`
        })
        onSaved()
      } else {
        setMessage({ kind: 'error', text: '저장하지 못했어요. 입력한 값을 확인해 주세요.' })
      }
    } catch {
      setMessage({ kind: 'error', text: '저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.' })
    } finally {
      setSaving(false)
    }
  }

  const touch = (): void => setMessage(null)

  return (
    <Panel title="경고 기준과 초기화">
      <form onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="settings-warn">경고 기준 (%)</label>
          <div className="field__row">
            <Input
              extraClass="limit-input"
              id="settings-warn"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={warn}
              aria-invalid={errors.warn ? true : undefined}
              aria-describedby="settings-warn-hint"
              onChange={(e) => {
                setWarn(e.target.value)
                touch()
              }}
            />
            <span aria-hidden="true">%</span>
          </div>
          <p className="hint" id="settings-warn-hint">
            한도의 이 비율에 도달하면 결재함에 알림 카드가 와요. 1에서 100 사이 정수예요.
          </p>
          {errors.warn && (
            <p role="alert" className="error">
              {errors.warn}
            </p>
          )}
        </div>
        <div className="field">
          <label htmlFor="settings-krw">환율 (1달러당 원)</label>
          <div className="field__row">
            <Input
              extraClass="limit-input"
              id="settings-krw"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={krw}
              aria-invalid={errors.krw ? true : undefined}
              aria-describedby="settings-krw-hint"
              onChange={(e) => {
                setKrw(e.target.value)
                touch()
              }}
            />
            <span aria-hidden="true">원</span>
          </div>
          <p className="hint" id="settings-krw-hint">
            종량제 비용을 원화로 바꿀 때 써요. 앱이 인터넷에서 조회하지 않으니 직접 입력해 주세요.
          </p>
          {errors.krw && (
            <p role="alert" className="error">
              {errors.krw}
            </p>
          )}
        </div>
        <div className="field">
          <label htmlFor="settings-weekday">한도 초기화 요일</label>
          <select
            id="settings-weekday"
            className="input"
            value={weekday}
            onChange={(e) => {
              setWeekday(Number(e.target.value))
              touch()
            }}
          >
            {WEEKDAY_LABELS.map((l, i) => (
              <option key={l} value={i}>
                {l}요일
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="settings-hour">한도 초기화 시각</label>
          <select
            id="settings-hour"
            className="input"
            value={hour}
            onChange={(e) => {
              setHour(Number(e.target.value))
              touch()
            }}
          >
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {h}시
              </option>
            ))}
          </select>
          <p className="hint">이 컴퓨터의 시간 기준이에요.</p>
        </div>
        <div className="toolbar">
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? '저장 중…' : '저장'}
          </Button>
        </div>
        <div role="status" aria-live="polite">
          {message && <p className={message.kind === 'error' ? 'error' : 'hint'}>{message.text}</p>}
        </div>
      </form>
    </Panel>
  )
}
