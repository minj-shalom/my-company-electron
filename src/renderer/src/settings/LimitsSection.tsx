import { useState } from 'react'
import {
  PROVIDER_CLI_IDS,
  WEEKLY_LIMIT_UNITS,
  type ProviderCliId,
  type WeeklyLimit,
  type WeeklyLimitUnit
} from '../../../shared/provider'
import { parseLimitInput } from '../onboarding/weekly-limit'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Panel } from '../ui/Panel'
import {
  AMOUNT_LABELS,
  AMOUNT_RULE_HINT,
  PLAN_HELP,
  PLAN_LABELS,
  PROVIDER_NAMES
} from './limit-wording'

import { toDrafts, type Draft, type Drafts } from './settings-model'

/** 제공자별 요금제와 주간 한도. 저장은 전체 교체이고, 빈 칸은 한도 없음이다. */
export function LimitsSection({
  limits,
  onSaved
}: {
  /** null = 불러오지 못함. */
  limits: WeeklyLimit[] | null
  onSaved: () => void
}): React.JSX.Element {
  const [drafts, setDrafts] = useState<Drafts>(() => toDrafts(limits ?? []))
  const [errors, setErrors] = useState<Partial<Record<ProviderCliId, string>>>({})
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  if (limits === null) {
    return (
      <Panel title="주간 한도">
        <p role="alert" className="error">
          저장된 한도를 불러오지 못했어요. 화면 위의 다시 불러오기 버튼을 눌러 주세요.
        </p>
      </Panel>
    )
  }

  const patch = (id: ProviderCliId, p: Partial<Draft>): void => {
    setDrafts({ ...drafts, [id]: { ...drafts[id], ...p } })
    setMessage(null)
  }

  const submit = async (e: React.SyntheticEvent): Promise<void> => {
    e.preventDefault()
    const nextErrors: Partial<Record<ProviderCliId, string>> = {}
    const out: WeeklyLimit[] = []
    for (const id of PROVIDER_CLI_IDS) {
      const p = parseLimitInput(drafts[id].text)
      if (!p.ok) nextErrors[id] = p.message
      else if (p.amount !== null)
        out.push({ provider: id, amount: p.amount, unit: drafts[id].unit })
    }
    setErrors(nextErrors)
    const first = PROVIDER_CLI_IDS.find((id) => nextErrors[id])
    if (first) {
      document.getElementById(`settings-limit-${first}`)?.focus()
      return
    }
    setSaving(true)
    try {
      const r = await window.api.saveWeeklyLimits({ limits: out })
      if (r.ok) {
        setMessage({ kind: 'ok', text: '저장했어요. 사용량 막대에 바로 반영돼요.' })
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

  return (
    <Panel title="주간 한도">
      <form onSubmit={submit} noValidate>
        <p className="hint">요금제는 앱이 알 수 없어서 직접 골라 주세요. {AMOUNT_RULE_HINT}</p>
        {PROVIDER_CLI_IDS.map((id) => {
          const d = drafts[id]
          const base = `settings-limit-${id}`
          const err = errors[id]
          return (
            <fieldset className="settings-fieldset" key={id}>
              <legend>{PROVIDER_NAMES[id]}</legend>
              <div className="field">
                <label htmlFor={`${base}-plan`}>요금제</label>
                <select
                  id={`${base}-plan`}
                  className="input"
                  value={d.unit}
                  aria-describedby={`${base}-plan-help`}
                  onChange={(e) => patch(id, { unit: e.target.value as WeeklyLimitUnit })}
                >
                  {WEEKLY_LIMIT_UNITS.map((u) => (
                    <option key={u} value={u}>
                      {PLAN_LABELS[u]}
                    </option>
                  ))}
                </select>
                <p className="hint" id={`${base}-plan-help`}>
                  {PLAN_HELP[d.unit]}
                </p>
              </div>
              <div className="field">
                <label htmlFor={base}>{AMOUNT_LABELS[d.unit]} (선택)</label>
                <div className="field__row">
                  <span aria-hidden="true">$</span>
                  <Input
                    extraClass="limit-input"
                    id={base}
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="예: 20"
                    value={d.text}
                    aria-invalid={err ? true : undefined}
                    aria-describedby={err ? `${base}-error` : undefined}
                    onChange={(e) => patch(id, { text: e.target.value })}
                  />
                </div>
                {err && (
                  <p id={`${base}-error`} role="alert" className="error">
                    {err}
                  </p>
                )}
              </div>
            </fieldset>
          )
        })}
        <div className="toolbar">
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? '저장 중…' : '한도 저장'}
          </Button>
        </div>
        <div role="status" aria-live="polite">
          {message && <p className={message.kind === 'error' ? 'error' : 'hint'}>{message.text}</p>}
        </div>
      </form>
    </Panel>
  )
}
