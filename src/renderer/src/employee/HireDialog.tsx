import { useEffect, useId, useRef, useState } from 'react'
import type { EmployeeTemplateInfo } from '../../../shared/employee-change'
import type { OrgSnapshot } from '../../../shared/org'
import { runExclusive } from '../lib/refresh'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Modal } from '../ui/Modal'
import {
  buildCreateRequest,
  defaultsFor,
  departmentNames,
  errorText,
  hasErrors,
  orderTemplates,
  validateHire,
  type HireFormValues
} from './employee-model'

type Load =
  { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; templates: EmployeeTemplateInfo[] }

/** 직접 채용(수동) 대화. 템플릿 카드 선택 -> 이름·직급·부서·보고 대상 -> 확인. 최종 판정은 main 응답이다. */
export function HireDialog({
  snapshot,
  onClose,
  onHired,
  offerAssign = false
}: {
  snapshot: OrgSnapshot
  onClose: () => void
  onHired: (employeeId: string, openAssign: boolean) => void
  /** 채용 직후 직원 상세의 담당 프로젝트 배정을 여는 선택지를 보인다 (조직도 화면). */
  offerAssign?: boolean
}): React.JSX.Element {
  const titleId = useId()
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  const [tick, setTick] = useState(0)
  const [values, setValues] = useState<HireFormValues | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [openAssign, setOpenAssign] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lock = useRef(false)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void window.api
      .listEmployeeTemplates()
      .then((r) => {
        if (cancelled) return
        setLoad(r.ok ? { kind: 'ready', templates: orderTemplates(r.value) } : { kind: 'error' })
      })
      .catch(() => !cancelled && setLoad({ kind: 'error' }))
    return () => {
      cancelled = true
    }
  }, [tick])

  const templates = load.kind === 'ready' ? load.templates : []
  const template = templates.find((t) => t.id === values?.templateId) ?? null
  const errors = values ? validateHire(values, snapshot) : {}
  const showErrors = (key: keyof HireFormValues): string | undefined =>
    values && (submitted || values[key] !== '')
      ? (errors as Record<string, string | undefined>)[key]
      : undefined
  const set = (patch: Partial<HireFormValues>): void => {
    setValues((v) => (v ? { ...v, ...patch } : v))
    setError(null)
  }

  const submit = (e: React.FormEvent): void => {
    e.preventDefault()
    setSubmitted(true)
    if (!values || !template || hasErrors(errors) || busy) return
    void runExclusive(lock, async () => {
      setBusy(true)
      setError(null)
      try {
        const r = await window.api.createEmployee(buildCreateRequest(values, template))
        if (!alive.current) return
        if (r.ok) onHired(r.value.record.employeeId, offerAssign && openAssign)
        else setError(errorText(r.code, 'create'))
      } catch {
        if (alive.current) setError(errorText('internal', 'create'))
      } finally {
        if (alive.current) setBusy(false)
      }
    })
  }

  return (
    <Modal labelledBy={titleId} busy={busy} onClose={onClose}>
      <form onSubmit={submit} noValidate className="hire-dialog">
        <h2 id={titleId} className="modal__title">
          직원 채용
        </h2>
        <div className="modal__body">
          {load.kind === 'loading' && (
            <p role="status" className="hint">
              직원 템플릿을 불러오고 있어요…
            </p>
          )}
          {load.kind === 'error' && (
            <div role="alert" className="error">
              <p>템플릿을 불러오지 못했어요.</p>
              <Button
                size="small"
                onClick={() => {
                  setLoad({ kind: 'loading' })
                  setTick((n) => n + 1)
                }}
              >
                다시 시도
              </Button>
            </div>
          )}
          {load.kind === 'ready' && templates.length === 0 && (
            <p className="empty-state">채용할 수 있는 템플릿이 없어요.</p>
          )}
          {load.kind === 'ready' && templates.length > 0 && (
            <>
              <fieldset className="hire-dialog__templates" disabled={busy}>
                <legend>템플릿</legend>
                <ul>
                  {templates.map((t) => (
                    <li
                      key={t.id}
                      className="hire-card"
                      data-selected={values?.templateId === t.id}
                    >
                      <label className="hire-card__label">
                        <input
                          type="radio"
                          name="hire-template"
                          value={t.id}
                          checked={values?.templateId === t.id}
                          onChange={() => {
                            setValues(defaultsFor(t, snapshot))
                            setSubmitted(false)
                            setError(null)
                          }}
                        />
                        <span className="hire-card__title">{t.title}</span>
                        {t.id === 'pm' && <Badge tone="info">PM 채용 바로가기</Badge>}
                      </label>
                      <p className="hire-card__desc">{t.description}</p>
                      {values?.templateId === t.id && (
                        <p className="hint">
                          기본 부서 {t.department} · 모델 {t.model}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </fieldset>
              {values && template && (
                <div className="hire-dialog__fields">
                  <Field
                    label="이름 (영문 id)"
                    error={showErrors('id')}
                    hint="직원 파일 이름이 돼요. 예: pm-2"
                  >
                    {(p) => (
                      <Input
                        {...p}
                        value={values.id}
                        maxLength={50}
                        autoComplete="off"
                        disabled={busy}
                        onChange={(e) => set({ id: e.target.value.trim() })}
                      />
                    )}
                  </Field>
                  <Field
                    label="직급"
                    error={showErrors('title')}
                    hint="조직도에 보이는 이름이에요."
                  >
                    {(p) => (
                      <Input
                        {...p}
                        value={values.title}
                        autoComplete="off"
                        disabled={busy}
                        onChange={(e) => set({ title: e.target.value })}
                      />
                    )}
                  </Field>
                  <Field label="부서" error={showErrors('department')}>
                    {(p) => (
                      <select
                        {...p}
                        className="input"
                        value={values.department}
                        disabled={busy}
                        onChange={(e) => set({ department: e.target.value })}
                      >
                        {departmentNames(snapshot).map((d) => (
                          <option key={d} value={d}>
                            {d}
                          </option>
                        ))}
                      </select>
                    )}
                  </Field>
                  <Field label="보고 대상" error={showErrors('reportsTo')}>
                    {(p) => (
                      <select
                        {...p}
                        className="input"
                        value={values.reportsTo}
                        disabled={busy}
                        onChange={(e) => set({ reportsTo: e.target.value })}
                      >
                        {snapshot.org.members.map((m) => (
                          <option key={m.title} value={m.title}>
                            {m.title}
                          </option>
                        ))}
                      </select>
                    )}
                  </Field>
                  {offerAssign && (
                    <label className="hire-dialog__assign">
                      <input
                        type="checkbox"
                        checked={openAssign}
                        disabled={busy}
                        onChange={(e) => setOpenAssign(e.target.checked)}
                      />
                      <span>채용 후 담당 프로젝트 배정하기</span>
                    </label>
                  )}
                </div>
              )}
            </>
          )}
          <div role="status" aria-live="polite" className={busy ? 'hint' : 'visually-hidden'}>
            {busy && '직원을 채용하고 있어요…'}
          </div>
          {error && (
            <p role="alert" className="error modal__error">
              {error}
            </p>
          )}
        </div>
        <div className="modal__actions">
          <Button disabled={busy} onClick={onClose}>
            취소
          </Button>
          <Button type="submit" variant="primary" aria-disabled={busy || !values} disabled={busy}>
            {busy ? '채용하는 중…' : '채용'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

/** 레이블, 도움말, 오류를 입력과 묶는다. 오류는 role=alert로 바로 읽힌다. */
export function Field({
  label,
  hint,
  error,
  children
}: {
  label: string
  hint?: string
  error?: string
  children: (props: {
    id: string
    'aria-invalid'?: true
    'aria-describedby'?: string
  }) => React.ReactNode
}): React.JSX.Element {
  const id = useId()
  const hintId = `${id}-hint`
  const errId = `${id}-err`
  const describedBy = [hint ? hintId : null, error ? errId : null].filter(Boolean).join(' ')
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children({
        id,
        ...(error ? { 'aria-invalid': true as const } : {}),
        ...(describedBy ? { 'aria-describedby': describedBy } : {})
      })}
      {hint && (
        <p id={hintId} className="hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={errId} role="alert" className="error">
          {error}
        </p>
      )}
    </div>
  )
}
