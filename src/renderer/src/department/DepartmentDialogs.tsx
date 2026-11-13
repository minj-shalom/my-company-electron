import { useEffect, useId, useRef, useState } from 'react'
import type { ApiResult } from '../../../shared/result'
import type { DepartmentChangeResult } from '../../../shared/department'
import { DEPARTMENT_NAME_MAX } from '../../../shared/department'
import type { OrgSnapshot } from '../../../shared/org'
import { Field } from '../employee/HireDialog'
import { runExclusive } from '../lib/refresh'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Modal } from '../ui/Modal'
import {
  departmentErrorText,
  leadCandidates,
  renameNeedsApproval,
  validateNewName,
  validateRename,
  type DepartmentAction
} from './department-model'

/** 요청 한 번을 잠그고 결과를 오류 문구나 성공으로 바꾼다. 닫힌 뒤 도착한 응답은 버린다. */
function useSubmit(
  action: DepartmentAction,
  call: () => Promise<ApiResult<DepartmentChangeResult>>,
  onDone: () => void
): { busy: boolean; error: string | null; clearError: () => void; run: () => void } {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lock = useRef(false)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  const run = (): void => {
    void runExclusive(lock, async () => {
      setBusy(true)
      setError(null)
      try {
        const r = await call()
        if (!alive.current) return
        if (r.ok) onDone()
        else setError(departmentErrorText(r.code, action))
      } catch {
        if (alive.current) setError(departmentErrorText('internal', action))
      } finally {
        if (alive.current) setBusy(false)
      }
    })
  }
  return { busy, error, clearError: () => setError(null), run }
}

function Actions({
  busy,
  submitLabel,
  busyLabel,
  danger,
  onClose
}: {
  busy: boolean
  submitLabel: string
  busyLabel: string
  danger?: boolean
  onClose: () => void
}): React.JSX.Element {
  return (
    <div className="modal__actions">
      <Button disabled={busy} onClick={onClose}>
        취소
      </Button>
      <Button
        type="submit"
        variant={danger ? 'default' : 'primary'}
        aria-disabled={busy}
        disabled={busy}
      >
        {busy ? busyLabel : submitLabel}
      </Button>
    </div>
  )
}

function ErrorLine({ error }: { error: string | null }): React.JSX.Element | null {
  return error ? (
    <p role="alert" className="error modal__error">
      {error}
    </p>
  ) : null
}

export function AddDepartmentDialog({
  snapshot,
  onClose,
  onDone
}: {
  snapshot: OrgSnapshot
  onClose: () => void
  onDone: (name: string) => void
}): React.JSX.Element {
  const titleId = useId()
  const candidates = leadCandidates(snapshot)
  const firstFree = candidates.find((c) => c.block === null)?.member.agentId ?? ''
  const [name, setName] = useState('')
  const [leadId, setLeadId] = useState(firstFree)
  const [submitted, setSubmitted] = useState(false)
  const nameError = validateNewName(name, snapshot)
  const leadError = leadId === '' ? '부서장이 될 직원을 골라 주세요.' : null
  const sub = useSubmit(
    'add',
    () => window.api.addDepartment({ name, leadId }),
    () => onDone(name)
  )
  return (
    <Modal labelledBy={titleId} busy={sub.busy} onClose={onClose}>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          setSubmitted(true)
          if (!nameError && !leadError && !sub.busy) sub.run()
        }}
      >
        <h2 id={titleId} className="modal__title">
          부서 추가
        </h2>
        <div className="modal__body">
          {candidates.length === 0 ? (
            <p className="empty-state">
              부서장이 될 직원이 아직 없어요. 먼저 직원을 채용한 뒤 부서를 추가해 주세요.
            </p>
          ) : (
            <>
              <p className="hint">
                부서에는 직원이 한 명 이상 있어야 해요. 먼저 채용한 직원을 부서장으로 골라 주세요.
                그 직원은 새 부서로 옮겨져요.
              </p>
              <Field
                label="부서 이름"
                hint={`${DEPARTMENT_NAME_MAX}자 이하. 예: 콘텐츠팀`}
                error={(submitted || name !== '') && nameError ? nameError : undefined}
              >
                {(p) => (
                  <Input
                    {...p}
                    value={name}
                    maxLength={DEPARTMENT_NAME_MAX + 5}
                    autoComplete="off"
                    autoFocus
                    disabled={sub.busy}
                    onChange={(e) => {
                      setName(e.target.value)
                      sub.clearError()
                    }}
                  />
                )}
              </Field>
              <Field label="부서장" error={submitted ? (leadError ?? undefined) : undefined}>
                {(p) => (
                  <select
                    {...p}
                    className="input"
                    value={leadId}
                    disabled={sub.busy}
                    onChange={(e) => {
                      setLeadId(e.target.value)
                      sub.clearError()
                    }}
                  >
                    {candidates.map((c) => (
                      <option
                        key={c.member.title}
                        value={c.member.agentId ?? ''}
                        disabled={c.block !== null}
                      >
                        {c.member.title} ({c.member.department ?? '소속 없음'})
                        {c.block ? ` - ${c.block}` : ''}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            </>
          )}
          <div role="status" aria-live="polite" className={sub.busy ? 'hint' : 'visually-hidden'}>
            {sub.busy && '부서를 만들고 있어요…'}
          </div>
          <ErrorLine error={sub.error} />
        </div>
        {candidates.length === 0 ? (
          <div className="modal__actions">
            <Button onClick={onClose}>닫기</Button>
          </div>
        ) : (
          <Actions
            busy={sub.busy}
            submitLabel="부서 추가"
            busyLabel="추가하는 중…"
            onClose={onClose}
          />
        )}
      </form>
    </Modal>
  )
}

export function RenameDepartmentDialog({
  from,
  snapshot,
  onClose,
  onDone
}: {
  from: string
  snapshot: OrgSnapshot
  onClose: () => void
  onDone: (to: string) => void
}): React.JSX.Element {
  const titleId = useId()
  const [to, setTo] = useState(from)
  const [submitted, setSubmitted] = useState(false)
  const error = validateRename(from, to, snapshot)
  const sub = useSubmit(
    'rename',
    () => window.api.renameDepartment({ from, to }),
    () => onDone(to)
  )
  return (
    <Modal labelledBy={titleId} busy={sub.busy} onClose={onClose}>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          setSubmitted(true)
          if (!error && !sub.busy) sub.run()
        }}
      >
        <h2 id={titleId} className="modal__title">
          {from} 이름 바꾸기
        </h2>
        <div className="modal__body">
          {renameNeedsApproval(from, snapshot) && (
            <p className="hint">CTO, CFO, 인사가 있는 부서라서 CEO 승인이 필요할 수 있어요.</p>
          )}
          <Field
            label="새 부서 이름"
            hint={`${DEPARTMENT_NAME_MAX}자 이하. 직원과 담당 프로젝트는 그대로예요.`}
            error={(submitted || to !== from) && error ? error : undefined}
          >
            {(p) => (
              <Input
                {...p}
                value={to}
                maxLength={DEPARTMENT_NAME_MAX + 5}
                autoComplete="off"
                autoFocus
                disabled={sub.busy}
                onChange={(e) => {
                  setTo(e.target.value)
                  sub.clearError()
                }}
              />
            )}
          </Field>
          <div role="status" aria-live="polite" className={sub.busy ? 'hint' : 'visually-hidden'}>
            {sub.busy && '이름을 바꾸고 있어요…'}
          </div>
          <ErrorLine error={sub.error} />
        </div>
        <Actions
          busy={sub.busy}
          submitLabel="이름 바꾸기"
          busyLabel="바꾸는 중…"
          onClose={onClose}
        />
      </form>
    </Modal>
  )
}

export function RemoveDepartmentDialog({
  name,
  onClose,
  onDone
}: {
  name: string
  onClose: () => void
  onDone: () => void
}): React.JSX.Element {
  const titleId = useId()
  const sub = useSubmit('remove', () => window.api.removeDepartment({ name }), onDone)
  return (
    <Modal labelledBy={titleId} busy={sub.busy} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!sub.busy) sub.run()
        }}
      >
        <h2 id={titleId} className="modal__title">
          {name} 부서를 지울까요?
        </h2>
        <div className="modal__body">
          <p>직원이 없는 빈 부서만 지울 수 있어요. 지우면 사무실에서 이 부서의 방도 사라져요.</p>
          <div role="status" aria-live="polite" className={sub.busy ? 'hint' : 'visually-hidden'}>
            {sub.busy && '부서를 지우고 있어요…'}
          </div>
          <ErrorLine error={sub.error} />
        </div>
        <Actions
          busy={sub.busy}
          submitLabel="부서 지우기"
          busyLabel="지우는 중…"
          danger
          onClose={onClose}
        />
      </form>
    </Modal>
  )
}
