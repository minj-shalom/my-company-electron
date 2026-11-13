import { useEffect, useId, useRef, useState } from 'react'
import {
  MAX_TICKET_CRITERIA,
  MAX_TICKET_CRITERION,
  MAX_TICKET_GOAL,
  MAX_TICKET_TITLE,
  type Ticket
} from '../../../shared/ticket'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Modal } from '../ui/Modal'
import {
  assigneeChoices,
  assigneeFor,
  charCount,
  draftFromTicket,
  EMPTY_DRAFT,
  hasErrors,
  loadFormOptions,
  needsPm,
  PM_REQUIRED_NOTE,
  projectChoices,
  saveErrorText,
  toRequestFields,
  validateDraft,
  type DraftErrors,
  type FormOptions,
  type TicketDraft
} from './ticket-form-model'

export type TicketFormMode = { kind: 'create' } | { kind: 'edit'; ticket: Ticket }

interface DialogProps {
  mode: TicketFormMode
  onClose: () => void
  /** 저장에 성공했다. 호출자가 목록을 갱신하고 폼을 닫는다. */
  onSaved: (ticket: Ticket) => void
  /** "PM 지정" 링크. 없으면 안내 문구만 보인다. */
  onAssignPm?: () => void
}

/** 새 티켓/편집 모달. 프로젝트와 직원 목록을 읽는 동안에는 로딩 상태를 보여 준다. */
export function TicketFormDialog(props: DialogProps): React.JSX.Element {
  const titleId = useId()
  const [options, setOptions] = useState<FormOptions | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let cancelled = false
    void loadFormOptions(window.api).then((o) => {
      if (!cancelled) setOptions(o)
    })
    return () => {
      cancelled = true
    }
  }, [])
  return (
    <Modal labelledBy={titleId} busy={busy} onClose={props.onClose}>
      <TicketFormBody {...props} titleId={titleId} options={options} onBusyChange={setBusy} />
    </Modal>
  )
}

interface BodyProps extends DialogProps {
  titleId: string
  /** null이면 아직 읽는 중. */
  options: FormOptions | null
  /** 저장 중에는 Esc로 닫히지 않도록 모달에 알린다. */
  onBusyChange?: (busy: boolean) => void
}

export function TicketFormBody({
  mode,
  titleId,
  options,
  onClose,
  onSaved,
  onAssignPm,
  onBusyChange
}: BodyProps): React.JSX.Element {
  const editing = mode.kind === 'edit'
  const heading = editing ? `${mode.ticket.id} 편집` : '새 티켓'
  if (options === null) {
    return (
      <>
        <h2 id={titleId} className="modal__title">
          {heading}
        </h2>
        <p role="status" className="hint">
          프로젝트와 직원 목록을 불러오고 있어요…
        </p>
        <div className="modal__actions">
          <Button onClick={onClose}>닫기</Button>
        </div>
      </>
    )
  }
  return (
    <TicketForm
      mode={mode}
      titleId={titleId}
      heading={heading}
      options={options}
      onClose={onClose}
      onSaved={onSaved}
      onAssignPm={onAssignPm}
      onBusyChange={onBusyChange}
    />
  )
}

function TicketForm({
  mode,
  titleId,
  heading,
  options,
  onClose,
  onSaved,
  onAssignPm,
  onBusyChange
}: Omit<BodyProps, 'options'> & { heading: string; options: FormOptions }): React.JSX.Element {
  const editing = mode.kind === 'edit'
  const [draft, setDraft] = useState<TicketDraft>(() =>
    mode.kind === 'edit' ? draftFromTicket(mode.ticket) : EMPTY_DRAFT
  )
  // 편집을 시작할 때의 본문. 충돌 뒤 최신 내용을 불러오면 이 값도 새로 받는다.
  const [expectedBody, setExpectedBody] = useState(mode.kind === 'edit' ? mode.ticket.body : '')
  const [assigneeTouched, setAssigneeTouched] = useState(false)
  const [errors, setErrors] = useState<DraftErrors | null>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<{ code: string; text: string } | null>(null)
  const lock = useRef(false)
  const titleRef = useRef<HTMLInputElement>(null)
  const goalRef = useRef<HTMLTextAreaElement>(null)
  const rowRefs = useRef<Array<HTMLInputElement | null>>([])
  const addRef = useRef<HTMLButtonElement>(null)
  const failureRef = useRef<HTMLDivElement>(null)
  const pendingFocus = useRef<number | 'add' | null>(null)
  const ids = {
    title: useId(),
    goal: useId(),
    project: useId(),
    assignee: useId(),
    criteria: useId(),
    titleErr: useId(),
    goalErr: useId(),
    critErr: useId()
  }

  useEffect(() => {
    onBusyChange?.(busy)
  }, [busy, onBusyChange])

  useEffect(() => {
    const f = pendingFocus.current
    if (f === null) return
    pendingFocus.current = null
    if (f === 'add') addRef.current?.focus()
    else rowRefs.current[f]?.focus()
  }, [draft.criteria.length])

  const set = (patch: Partial<TicketDraft>): void => {
    setDraft((d) => ({ ...d, ...patch }))
    if (errors) setErrors(null)
  }
  const setRow = (i: number, v: string): void =>
    set({ criteria: draft.criteria.map((c, j) => (j === i ? v : c)) })
  const addRow = (): void => {
    if (draft.criteria.length >= MAX_TICKET_CRITERIA) return
    pendingFocus.current = draft.criteria.length
    set({ criteria: [...draft.criteria, ''] })
  }
  const removeRow = (i: number): void => {
    if (draft.criteria.length <= 1) {
      set({ criteria: [''] })
      rowRefs.current[0]?.focus()
      return
    }
    pendingFocus.current = Math.min(i, draft.criteria.length - 2)
    set({ criteria: draft.criteria.filter((_, j) => j !== i) })
  }

  const changeProject = (projectId: string): void => {
    // 담당을 직접 고르지 않았다면 새 프로젝트의 담당 PM을 기본으로 채운다 (편집 중인 티켓의 담당은 건드리지 않는다).
    set(
      !editing && !assigneeTouched
        ? { projectId, assignee: assigneeFor(options.projects, projectId) }
        : { projectId }
    )
  }

  const submit = async (): Promise<void> => {
    if (lock.current) return
    const found = validateDraft(draft)
    if (hasErrors(found)) {
      setErrors(found)
      const firstRow = Object.keys(found.rows).map(Number)[0]
      if (found.title) titleRef.current?.focus()
      else if (found.goal) goalRef.current?.focus()
      else
        rowRefs.current[
          firstRow ??
            Math.max(
              0,
              draft.criteria.findIndex((c) => c.trim() === '')
            )
        ]?.focus()
      return
    }
    lock.current = true
    setBusy(true)
    setFailure(null)
    try {
      const fields = toRequestFields(draft)
      const r =
        mode.kind === 'edit'
          ? await window.api.updateTicket({
              id: mode.ticket.id,
              expectedBody,
              ...fields,
              department: mode.ticket.department ?? null
            })
          : await window.api.createTicket(fields)
      if (r.ok) {
        onSaved(r.value)
        return
      }
      setFailure({ code: r.code, text: saveErrorText(r.code, r.message) })
    } catch {
      setFailure({ code: 'unknown', text: saveErrorText('unknown', '') })
    } finally {
      lock.current = false
      setBusy(false)
    }
    failureRef.current?.focus()
  }

  const reloadLatest = async (): Promise<void> => {
    if (mode.kind !== 'edit' || lock.current) return
    lock.current = true
    setBusy(true)
    try {
      const r = await window.api.getTicket(mode.ticket.id)
      if (r.ok && r.value.status === 'backlog' && r.value.bodyTruncated !== true) {
        setDraft(draftFromTicket(r.value))
        setExpectedBody(r.value.body)
        setAssigneeTouched(false)
        setErrors(null)
        setFailure(null)
      } else {
        setFailure({
          code: 'unknown',
          text: r.ok
            ? '이 티켓은 이제 고칠 수 없는 상태예요. 닫고 보드를 확인해 주세요.'
            : saveErrorText(r.code, r.message)
        })
      }
    } catch {
      setFailure({ code: 'unknown', text: saveErrorText('unknown', '') })
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  const projects = projectChoices(options, draft.projectId)
  const assignees = assigneeChoices(options, draft.assignee)
  const e = errors ?? { rows: {} }
  const pmNote = needsPm(options, draft.projectId)
  const filledCount = draft.criteria.filter((c) => c.trim() !== '').length

  return (
    <form
      className="modal__body tform"
      noValidate
      aria-busy={busy}
      onSubmit={(ev) => {
        ev.preventDefault()
        void submit()
      }}
    >
      <h2 id={titleId} className="modal__title">
        {heading}
      </h2>
      {(options.projectsFailed || options.employeesFailed) && (
        <p role="status" className="notice">
          {options.projectsFailed &&
            '프로젝트 목록을 불러오지 못해 지금은 "회사 공통"만 고를 수 있어요. '}
          {options.employeesFailed &&
            '직원 목록을 불러오지 못해 지금은 "담당 없음"만 고를 수 있어요.'}
        </p>
      )}

      <div className="field">
        <label htmlFor={ids.title}>제목</label>
        <Input
          id={ids.title}
          ref={titleRef}
          value={draft.title}
          disabled={busy}
          autoFocus
          aria-required="true"
          aria-invalid={e.title !== undefined}
          aria-describedby={e.title ? ids.titleErr : undefined}
          onChange={(ev) => set({ title: ev.target.value })}
        />
        <p className="hint tform__count">
          {charCount(draft.title)} / {MAX_TICKET_TITLE}자
        </p>
        {e.title && (
          <p id={ids.titleErr} role="alert" className="error">
            {e.title}
          </p>
        )}
      </div>

      <div className="field">
        <label htmlFor={ids.goal}>목표</label>
        <textarea
          id={ids.goal}
          ref={goalRef}
          className="input tform__goal"
          rows={4}
          value={draft.goal}
          disabled={busy}
          aria-invalid={e.goal !== undefined}
          aria-describedby={e.goal ? ids.goalErr : undefined}
          onChange={(ev) => set({ goal: ev.target.value })}
        />
        <p className="hint tform__count">
          {charCount(draft.goal)} / {MAX_TICKET_GOAL}자
        </p>
        {e.goal && (
          <p id={ids.goalErr} role="alert" className="error">
            {e.goal}
          </p>
        )}
      </div>

      <fieldset
        className="tform__criteria"
        aria-describedby={e.criteria ? ids.critErr : undefined}
        disabled={busy}
      >
        <legend>완료 조건 (1개 이상)</legend>
        <ul className="tform__rows">
          {draft.criteria.map((c, i) => (
            // 항목은 순서로만 구분되고 삭제하면 포커스를 인덱스로 옮기므로 인덱스를 key로 쓴다.
            <li key={i} className="tform__row">
              <label htmlFor={`${ids.criteria}-${i}`} className="visually-hidden">
                {`완료 조건 ${i + 1}`}
              </label>
              <Input
                id={`${ids.criteria}-${i}`}
                ref={(el) => {
                  rowRefs.current[i] = el
                }}
                extraClass="tform__row-input"
                value={c}
                aria-invalid={
                  e.rows[i] !== undefined || (e.criteria !== undefined && c.trim() === '')
                }
                placeholder="예: 저장하면 보드에 카드가 나타난다"
                onChange={(ev) => setRow(i, ev.target.value)}
                onKeyDown={(ev) => {
                  // Enter는 폼 제출 대신 다음 항목을 추가한다 (제출은 저장 버튼).
                  if (ev.key === 'Enter') {
                    ev.preventDefault()
                    if (i === draft.criteria.length - 1) addRow()
                    else rowRefs.current[i + 1]?.focus()
                  }
                }}
              />
              <span className="hint tform__row-count" aria-hidden="true">
                {charCount(c)}/{MAX_TICKET_CRITERION}
              </span>
              <Button
                size="small"
                aria-label={`완료 조건 ${i + 1} 삭제`}
                onClick={() => removeRow(i)}
              >
                삭제
              </Button>
              {e.rows[i] && (
                <p role="alert" className="error tform__row-error">
                  {e.rows[i]}
                </p>
              )}
            </li>
          ))}
        </ul>
        <Button
          size="small"
          ref={addRef}
          disabled={draft.criteria.length >= MAX_TICKET_CRITERIA}
          onClick={addRow}
        >
          항목 추가
        </Button>
        <span className="hint">
          {' '}
          {filledCount} / {MAX_TICKET_CRITERIA}개
        </span>
        {e.criteria && (
          <p id={ids.critErr} role="alert" className="error">
            {e.criteria}
          </p>
        )}
      </fieldset>

      <div className="field">
        <label htmlFor={ids.project}>프로젝트</label>
        <select
          id={ids.project}
          className="input"
          value={draft.projectId}
          disabled={busy}
          onChange={(ev) => changeProject(ev.target.value)}
        >
          {projects.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
        {pmNote && (
          <p className="notice tform__pm" role="note">
            {PM_REQUIRED_NOTE}{' '}
            {onAssignPm && (
              <Button size="small" onClick={onAssignPm} disabled={busy}>
                PM 지정
              </Button>
            )}
          </p>
        )}
      </div>

      <div className="field">
        <label htmlFor={ids.assignee}>담당</label>
        <select
          id={ids.assignee}
          className="input"
          value={draft.assignee}
          disabled={busy}
          onChange={(ev) => {
            setAssigneeTouched(true)
            set({ assignee: ev.target.value })
          }}
        >
          {assignees.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </select>
        <p className="hint">
          {editing
            ? '담당 없음은 오류가 아니에요. COO가 채용이 필요한 업무로 다뤄요.'
            : '프로젝트를 고르면 그 프로젝트의 담당 PM이 기본으로 채워져요.'}
        </p>
      </div>

      <div ref={failureRef} tabIndex={-1}>
        {failure && (
          <div role="alert" className="error modal__error">
            <p>{failure.text}</p>
            {failure.code === 'conflict' && editing && (
              <>
                <p className="hint">
                  지금 내용은 사라지지 않았어요. 최신 내용을 불러오면 입력한 값이 바뀌어요.
                </p>
                <Button size="small" onClick={() => void reloadLatest()} disabled={busy}>
                  최신 내용 불러오기
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      <div className="modal__actions">
        <Button disabled={busy} onClick={onClose}>
          취소
        </Button>
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? '저장하는 중…' : editing ? '저장' : '티켓 만들기'}
        </Button>
      </div>
    </form>
  )
}
