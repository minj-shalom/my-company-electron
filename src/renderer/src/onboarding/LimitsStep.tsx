import { useEffect, useState } from 'react'
import {
  PROVIDER_CLI_IDS,
  WEEKLY_LIMIT_MAX,
  type ProviderCliId,
  type WeeklyLimit
} from '../../../shared/provider'
import { PROVIDER_GUIDES } from './provider-guide'
import { parseLimitInput } from './weekly-limit'

type Texts = Record<ProviderCliId, string>
type Errors = Partial<Record<ProviderCliId, string>>

const EMPTY: Texts = { claude: '', codex: '', gemini: '' }

interface Props {
  onBack: () => void
  onSaved: (limits: WeeklyLimit[]) => void
}

export function LimitsStep({ onBack, onSaved }: Props): React.JSX.Element {
  const [texts, setTexts] = useState<Texts>(EMPTY)
  const [errors, setErrors] = useState<Errors>({})
  const [loading, setLoading] = useState(true)
  const [loadNotice, setLoadNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  useEffect(() => {
    let cancelled = false
    window.api
      .getWeeklyLimits()
      .then((r) => {
        if (cancelled) return
        if (r.ok) {
          const next = { ...EMPTY }
          for (const l of r.value) next[l.provider] = String(l.amount)
          setTexts(next)
        } else {
          setLoadNotice('저장된 한도를 불러오지 못했어요. 새로 입력해 주세요.')
        }
      })
      .catch(() => {
        if (!cancelled) setLoadNotice('저장된 한도를 불러오지 못했어요. 새로 입력해 주세요.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const submit = async (e: React.SyntheticEvent): Promise<void> => {
    e.preventDefault()
    const nextErrors: Errors = {}
    const limits: WeeklyLimit[] = []
    for (const id of PROVIDER_CLI_IDS) {
      const p = parseLimitInput(texts[id])
      if (!p.ok) nextErrors[id] = p.message
      else if (p.amount !== null) limits.push({ provider: id, amount: p.amount, unit: 'usd' })
    }
    setErrors(nextErrors)
    const firstInvalid = PROVIDER_CLI_IDS.find((id) => nextErrors[id])
    if (firstInvalid) {
      document.getElementById(`limit-${firstInvalid}`)?.focus()
      return
    }
    setSaving(true)
    setSaveError('')
    try {
      const r = await window.api.saveWeeklyLimits({ limits })
      if (r.ok) onSaved(r.value)
      else {
        setSaveError(
          r.code === 'not-implemented'
            ? '이 버전의 앱은 아직 한도를 저장할 수 없어요.'
            : '저장하지 못했어요. 입력한 값을 확인하고 다시 시도해 주세요.'
        )
      }
    } catch {
      setSaveError('저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p role="status">저장된 한도를 불러오는 중이에요…</p>

  return (
    <form onSubmit={submit} noValidate>
      <p>
        AI를 쓰는 양이 너무 많아지지 않도록, 한 주에 쓸 수 있는 <strong>예산(달러)</strong>을 정해
        주세요. 앱은 이 금액의 80%에 가까워지면 알려 드려요.
      </p>
      <p className="hint">
        잘 모르겠으면 비워 두세요. 나중에 바꿀 수 있어요. 여기에는 <strong>금액 숫자만</strong>{' '}
        입력합니다. 토큰, 비밀번호, API 키는 절대 입력하지 마세요.
      </p>
      {loadNotice && (
        <p role="alert" className="error">
          {loadNotice}
        </p>
      )}
      {PROVIDER_GUIDES.map((g) => {
        const inputId = `limit-${g.id}`
        const errId = `${inputId}-error`
        return (
          <div className="field" key={g.id}>
            <label htmlFor={inputId}>{g.name} 주간 한도 (달러, 선택)</label>
            <div className="field__row">
              <span aria-hidden="true">$</span>
              <input
                id={inputId}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                spellCheck={false}
                placeholder="예: 20"
                value={texts[g.id]}
                aria-invalid={errors[g.id] ? true : undefined}
                aria-describedby={errors[g.id] ? errId : undefined}
                onChange={(e) => setTexts({ ...texts, [g.id]: e.target.value })}
              />
            </div>
            {errors[g.id] && (
              <p id={errId} role="alert" className="error">
                {errors[g.id]}
              </p>
            )}
          </div>
        )
      })}
      <p className="hint">
        0보다 크고 {WEEKLY_LIMIT_MAX.toLocaleString('en-US')} 이하의 숫자만 쓸 수 있어요.
      </p>
      {saveError && (
        <p role="alert" className="error">
          {saveError}
        </p>
      )}
      <div className="toolbar">
        <button type="button" onClick={onBack} disabled={saving}>
          이전
        </button>
        <button type="submit" className="primary" disabled={saving}>
          {saving ? '저장 중…' : '저장하고 마치기'}
        </button>
      </div>
    </form>
  )
}
