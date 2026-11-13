import { useEffect, useId, useRef, useState } from 'react'
import { EMPLOYEE_MODELS, type EmployeeModel } from '../../../shared/employee-change'
import type { OrgAgentDetail, OrgMember, OrgSnapshot } from '../../../shared/org'
import type { DomainErrorCode } from '../../../shared/result'
import { runExclusive } from '../lib/refresh'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { Field } from './HireDialog'
import {
  buildMoveRequest,
  buildUpdateRequest,
  departmentNames,
  errorText,
  hasErrors,
  initialEdit,
  isEditDirty,
  isStaleCode,
  mayNeedApproval,
  parseToolInput,
  protectedNote,
  reportTargets,
  retireBlockReason,
  validateEdit,
  validateMove,
  type EditValues,
  type EmployeeAction,
  type MoveValues
} from './employee-model'

type Mode = 'view' | 'edit' | 'move'
type Phase =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'done'; text: string }
  | { kind: 'error'; text: string; stale: boolean }

/** 직원 상세 아래의 관리 영역: 담당 프로젝트(읽기 전용), 편집, 부서·보고 대상 변경, 퇴사. 직원을 바꾸면 key로 새로 시작한다. */
export function MemberManager({
  member,
  snapshot,
  onDirtyChange,
  onChanged,
  onRetired
}: {
  member: OrgMember
  snapshot: OrgSnapshot
  onDirtyChange: (dirty: boolean) => void
  /** 조직을 다시 읽는다. */
  onChanged: () => void
  onRetired: () => void
}): React.JSX.Element {
  const agent = snapshot.agents.find((a) => a.id === member.agentId)
  const [mode, setMode] = useState<Mode>('view')
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [retiring, setRetiring] = useState(false)
  const pmProjects = useActivePmProjects(member.agentId)
  const note = protectedNote(member)
  const editable = member.kind === 'agent' && !!member.agentId && member.fileExists
  const finish = (text: string): void => {
    setMode('view')
    setPhase({ kind: 'done', text })
    onChanged()
  }
  const fail = (code: DomainErrorCode, action: EmployeeAction): void =>
    setPhase({ kind: 'error', text: errorText(code, action), stale: isStaleCode(code) })
  useEffect(() => {
    if (mode !== 'edit') onDirtyChange(false)
  }, [mode, onDirtyChange])
  // 직원이 바뀌어 언마운트될 때 낡은 dirty 표시가 남지 않게 한다.
  useEffect(() => () => onDirtyChange(false), [onDirtyChange])
  // 충돌 뒤 "다시 불러오기"를 누르면 이후 도착하는 최신 직원 값으로 폼을 새로 시작한다.
  const [reloaded, setReloaded] = useState(false)
  const reload = (): void => {
    setReloaded(true)
    setPhase({ kind: 'idle' })
    onChanged()
  }

  return (
    <div className="member-manager">
      <dl className="org-detail__list">
        <dt>담당 프로젝트</dt>
        <dd>
          <ul className="org-tools" aria-label="담당 프로젝트">
            {pmProjects.length > 0 ? (
              pmProjects.map((p) => (
                <li key={p}>
                  <Badge tone="info">{p} · PM</Badge>
                </li>
              ))
            ) : (
              <li>
                <Badge>배정 대기</Badge>
              </li>
            )}
          </ul>
        </dd>
      </dl>
      {note && <p className="notice">{note}</p>}
      {phase.kind === 'done' && mode === 'view' && (
        <p role="status" className="member-manager__done">
          {phase.text}
        </p>
      )}
      {mode === 'view' && (
        <div className="member-manager__actions">
          <Button
            size="small"
            disabled={!editable}
            onClick={() => (setPhase({ kind: 'idle' }), setMode('edit'))}
          >
            편집
          </Button>
          <Button
            size="small"
            disabled={!editable}
            onClick={() => (setPhase({ kind: 'idle' }), setMode('move'))}
          >
            부서·보고 대상 변경
          </Button>
          <RetireButton
            snapshot={snapshot}
            member={member}
            pmProjects={pmProjects}
            onClick={() => setRetiring(true)}
          />
        </div>
      )}
      {mode === 'edit' && agent !== undefined && member.agentId && (
        <EditForm
          key={reloaded ? JSON.stringify(agent) : 'initial'}
          id={member.agentId}
          agent={agent}
          phase={phase}
          setPhase={setPhase}
          onDirtyChange={onDirtyChange}
          onCancel={() => setMode('view')}
          onSaved={() => finish('저장했어요.')}
          onFail={(c) => fail(c, 'update')}
          onReload={reload}
        />
      )}
      {mode === 'edit' && agent === undefined && (
        <p role="alert" className="error">
          직원 파일 정보를 읽지 못해 편집할 수 없어요. 조직도를 다시 불러와 주세요.
        </p>
      )}
      {mode === 'move' && member.agentId && (
        <MoveForm
          id={member.agentId}
          member={member}
          snapshot={snapshot}
          phase={phase}
          setPhase={setPhase}
          onCancel={() => setMode('view')}
          onMoved={() => finish('옮겼어요.')}
          onFail={(c) => fail(c, 'move')}
          onReload={onChanged}
        />
      )}
      {retiring && member.agentId && (
        <RetireDialog
          id={member.agentId}
          member={member}
          onClose={() => setRetiring(false)}
          onRetired={() => {
            setRetiring(false)
            onChanged()
            onRetired()
          }}
        />
      )}
    </div>
  )
}

/** 이 직원이 담당 PM인 활성 프로젝트 이름. 조회 실패는 빈 목록으로 두고(퇴사는 main이 최종 판정) 화면을 막지 않는다. */
function useActivePmProjects(agentId: string | null): string[] {
  const [names, setNames] = useState<string[]>([])
  useEffect(() => {
    if (!agentId) return
    let cancelled = false
    void window.api
      .listProjects()
      .then((r) => {
        if (cancelled || !r.ok) return
        setNames(
          r.value.items
            .filter((p) => p.status === 'active' && p.pmId === agentId)
            .map((p) => p.name)
        )
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [agentId])
  return names
}

function RetireButton({
  snapshot,
  member,
  pmProjects,
  onClick
}: {
  snapshot: OrgSnapshot
  member: OrgMember
  pmProjects: string[]
  onClick: () => void
}): React.JSX.Element {
  const reasonId = useId()
  const reason = retireBlockReason(snapshot, member, pmProjects)
  return (
    <>
      <Button
        size="small"
        aria-disabled={reason !== null}
        aria-describedby={reason ? reasonId : undefined}
        onClick={() => reason === null && onClick()}
      >
        퇴사
      </Button>
      {reason && (
        <p id={reasonId} className="hint member-manager__reason">
          {reason}
        </p>
      )}
    </>
  )
}

function PhaseNotice({
  phase,
  onReload
}: {
  phase: Phase
  onReload: () => void
}): React.JSX.Element {
  return (
    <>
      <div
        role="status"
        aria-live="polite"
        className={phase.kind === 'busy' ? 'hint' : 'visually-hidden'}
      >
        {phase.kind === 'busy' && '저장하고 있어요…'}
      </div>
      {phase.kind === 'error' && (
        <div role="alert" className="error">
          <p>{phase.text}</p>
          {phase.stale && (
            <Button size="small" onClick={onReload}>
              다시 불러오기
            </Button>
          )}
        </div>
      )}
    </>
  )
}

function EditForm({
  id,
  agent,
  phase,
  setPhase,
  onDirtyChange,
  onCancel,
  onSaved,
  onFail,
  onReload
}: {
  id: string
  agent: OrgAgentDetail
  phase: Phase
  setPhase: (p: Phase) => void
  onDirtyChange: (dirty: boolean) => void
  onCancel: () => void
  onSaved: () => void
  onFail: (code: DomainErrorCode) => void
  onReload: () => void
}): React.JSX.Element {
  const [initial] = useState(() => initialEdit(agent))
  const [values, setValues] = useState<EditValues>(initial)
  const [toolInput, setToolInput] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const lock = useRef(false)
  const firstRef = useRef<HTMLTextAreaElement>(null)
  const alive = useRef(true)
  const busy = phase.kind === 'busy'
  const dirty = isEditDirty(initial, values)
  const errors = validateEdit(values)
  const noChange = buildUpdateRequest(id, initial, values) === null
  const bodyId = useId()
  useEffect(() => {
    firstRef.current?.focus()
    return () => {
      alive.current = false
    }
  }, [])
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange])
  const patch = (p: Partial<EditValues>): void => {
    setValues((v) => ({ ...v, ...p }))
    if (phase.kind === 'error') setPhase({ kind: 'idle' })
  }
  const addTools = (): void => {
    const add = parseToolInput(toolInput)
    if (add.length === 0) return
    patch({ tools: [...new Set([...values.tools, ...add])] })
    setToolInput('')
  }

  const submit = (e: React.FormEvent): void => {
    e.preventDefault()
    setSubmitted(true)
    const req = buildUpdateRequest(id, initial, values)
    if (hasErrors(errors) || !req || busy) return
    void runExclusive(lock, async () => {
      setPhase({ kind: 'busy' })
      try {
        const r = await window.api.updateEmployee(req)
        if (!alive.current) return
        if (r.ok) {
          onDirtyChange(false)
          onSaved()
        } else onFail(r.code)
      } catch {
        if (alive.current) onFail('internal')
      }
    })
  }

  const cancel = (): void => (dirty ? setConfirmLeave(true) : onCancel())

  return (
    <form className="member-manager__form" onSubmit={submit} noValidate aria-label="직원 편집">
      <Field label="설명" error={submitted ? errors.description : undefined}>
        {(p) => (
          <textarea
            {...p}
            ref={firstRef}
            className="input member-manager__textarea"
            rows={3}
            value={values.description}
            disabled={busy}
            onChange={(e) => patch({ description: e.target.value })}
          />
        )}
      </Field>
      <Field label="모델">
        {(p) => (
          <select
            {...p}
            className="input"
            value={values.model}
            disabled={busy}
            onChange={(e) => patch({ model: e.target.value as EmployeeModel | '' })}
          >
            <option value="">{initial.model ? initial.model : '(지정 안 됨) 그대로 두기'}</option>
            {EMPLOYEE_MODELS.filter((m) => m !== initial.model).map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        )}
      </Field>
      <fieldset className="member-manager__tools" disabled={busy}>
        <legend>도구</legend>
        {values.tools.length > 0 ? (
          <ul className="org-tools" aria-label="선택된 도구">
            {values.tools.map((t) => (
              <li key={t}>
                <code>{t}</code>
                <button
                  type="button"
                  className="member-manager__remove"
                  aria-label={`${t} 도구 빼기`}
                  onClick={() => patch({ tools: values.tools.filter((x) => x !== t) })}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="hint">도구가 없으면 모든 도구를 상속해요.</p>
        )}
        <div className="member-manager__tool-add">
          <label htmlFor={`${bodyId}-tool`} className="visually-hidden">
            추가할 도구 이름
          </label>
          <Input
            id={`${bodyId}-tool`}
            value={toolInput}
            placeholder="예: Read, Grep"
            autoComplete="off"
            onChange={(e) => setToolInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addTools()
              }
            }}
          />
          <Button size="small" onClick={addTools}>
            도구 추가
          </Button>
        </div>
        {errors.tools && (
          <p role="alert" className="error">
            {errors.tools}
          </p>
        )}
        {mayNeedApproval(initial, values) && (
          <p className="notice">도구를 늘리면 CEO 승인이 필요할 수 있어요.</p>
        )}
      </fieldset>
      <Field
        label="프롬프트 교체 (평문)"
        hint="현재 프롬프트는 이 화면에서 보여 주지 않아요. 비워 두면 그대로 유지하고, 입력하면 통째로 바뀌어요."
        error={errors.body}
      >
        {(p) => (
          <textarea
            {...p}
            className="input member-manager__textarea"
            rows={6}
            value={values.body}
            disabled={busy}
            spellCheck={false}
            onChange={(e) => patch({ body: e.target.value })}
          />
        )}
      </Field>
      <PhaseNotice phase={phase} onReload={onReload} />
      <div className="member-manager__actions">
        <Button type="submit" variant="primary" aria-disabled={busy || noChange} disabled={busy}>
          {busy ? '저장하는 중…' : '저장'}
        </Button>
        <Button disabled={busy} onClick={cancel}>
          취소
        </Button>
        {!dirty && <span className="hint">바꾼 내용이 없어요.</span>}
      </div>
      {confirmLeave && (
        <LeaveDialog
          onStay={() => setConfirmLeave(false)}
          onLeave={() => {
            setConfirmLeave(false)
            onCancel()
          }}
        />
      )}
    </form>
  )
}

export function LeaveDialog({
  onStay,
  onLeave
}: {
  onStay: () => void
  onLeave: () => void
}): React.JSX.Element {
  const titleId = useId()
  return (
    <Modal labelledBy={titleId} onClose={onStay}>
      <h2 id={titleId} className="modal__title">
        저장하지 않은 변경이 있어요
      </h2>
      <p>지금 나가면 바꾼 내용이 사라져요.</p>
      <div className="modal__actions">
        <Button variant="primary" onClick={onStay}>
          계속 편집
        </Button>
        <Button onClick={onLeave}>변경 버리고 나가기</Button>
      </div>
    </Modal>
  )
}

function MoveForm({
  id,
  member,
  snapshot,
  phase,
  setPhase,
  onCancel,
  onMoved,
  onFail,
  onReload
}: {
  id: string
  member: OrgMember
  snapshot: OrgSnapshot
  phase: Phase
  setPhase: (p: Phase) => void
  onCancel: () => void
  onMoved: () => void
  onFail: (code: DomainErrorCode) => void
  onReload: () => void
}): React.JSX.Element {
  const [values, setValues] = useState<MoveValues>({
    department: member.department ?? '',
    reportsTo: member.reportsTo ?? ''
  })
  const lock = useRef(false)
  const alive = useRef(true)
  const firstRef = useRef<HTMLSelectElement>(null)
  const busy = phase.kind === 'busy'
  const problem = validateMove(snapshot, member, values)
  const req = buildMoveRequest(id, member, values)
  const depts = departmentNames(snapshot)
  useEffect(() => {
    firstRef.current?.focus()
    return () => {
      alive.current = false
    }
  }, [])
  const change = (p: Partial<MoveValues>): void => {
    setValues((v) => ({ ...v, ...p }))
    if (phase.kind === 'error') setPhase({ kind: 'idle' })
  }

  const submit = (e: React.FormEvent): void => {
    e.preventDefault()
    if (problem || !req || busy) return
    void runExclusive(lock, async () => {
      setPhase({ kind: 'busy' })
      try {
        const r = await window.api.moveEmployee(req)
        if (!alive.current) return
        if (r.ok) onMoved()
        else onFail(r.code)
      } catch {
        if (alive.current) onFail('internal')
      }
    })
  }

  return (
    <form
      className="member-manager__form"
      onSubmit={submit}
      noValidate
      aria-label="부서·보고 대상 변경"
    >
      <Field label="부서">
        {(p) => (
          <select
            {...p}
            ref={firstRef}
            className="input"
            value={values.department}
            disabled={busy}
            onChange={(e) => change({ department: e.target.value })}
          >
            {depts.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="보고 대상" hint="이 직원 아래에 있는 직원은 고를 수 없어요 (순환 방지).">
        {(p) => (
          <select
            {...p}
            className="input"
            value={values.reportsTo}
            disabled={busy}
            onChange={(e) => change({ reportsTo: e.target.value })}
          >
            {member.reportsTo === null && <option value="">(없음, 최상위)</option>}
            {reportTargets(snapshot, member).map((m) => (
              <option key={m.title} value={m.title}>
                {m.title}
              </option>
            ))}
          </select>
        )}
      </Field>
      {problem && (
        <p role="alert" className="error">
          {problem}
        </p>
      )}
      <PhaseNotice phase={phase} onReload={onReload} />
      <div className="member-manager__actions">
        <Button
          type="submit"
          variant="primary"
          aria-disabled={busy || !!problem || !req}
          disabled={busy}
        >
          {busy ? '옮기는 중…' : '변경'}
        </Button>
        <Button disabled={busy} onClick={onCancel}>
          취소
        </Button>
        {!req && !problem && <span className="hint">바꾼 내용이 없어요.</span>}
      </div>
    </form>
  )
}

function RetireDialog({
  id,
  member,
  onClose,
  onRetired
}: {
  id: string
  member: OrgMember
  onClose: () => void
  onRetired: () => void
}): React.JSX.Element {
  const titleId = useId()
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const lock = useRef(false)
  const busy = phase.kind === 'busy'
  const run = (): void => {
    void runExclusive(lock, async () => {
      setPhase({ kind: 'busy' })
      try {
        const r = await window.api.retireEmployee({ id })
        if (r.ok) onRetired()
        else
          setPhase({ kind: 'error', text: errorText(r.code, 'retire'), stale: isStaleCode(r.code) })
      } catch {
        setPhase({ kind: 'error', text: errorText('internal', 'retire'), stale: false })
      }
    })
  }
  return (
    <Modal labelledBy={titleId} busy={busy} onClose={onClose}>
      <h2 id={titleId} className="modal__title">
        {member.title} 퇴사
      </h2>
      <div className="modal__body">
        <p>삭제가 아니라 보관돼요. 직원 파일은 보관 폴더로 옮겨지고 조직도에서만 빠져요.</p>
        <div role="status" aria-live="polite" className={busy ? 'hint' : 'visually-hidden'}>
          {busy && '퇴사 처리하고 있어요…'}
        </div>
        {phase.kind === 'error' && (
          <p role="alert" className="error modal__error">
            {phase.text}
          </p>
        )}
      </div>
      <div className="modal__actions">
        <Button disabled={busy} onClick={onClose}>
          취소
        </Button>
        <Button variant="primary" aria-disabled={busy} disabled={busy} onClick={run}>
          {busy ? '처리하는 중…' : '퇴사 처리'}
        </Button>
      </div>
    </Modal>
  )
}
