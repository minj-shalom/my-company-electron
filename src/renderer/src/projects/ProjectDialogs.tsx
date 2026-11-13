import { useId, useState } from 'react'
import {
  PROJECT_TYPES,
  MAX_PROJECT_NAME,
  checkProjectName,
  type ProjectType
} from '../../../shared/project'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { PmFields } from './PmFields'
import {
  TYPE_LABELS,
  defaultPmChoice,
  suggestName,
  validateAddForm,
  type ActionResult,
  type AddInput,
  type AddOutcome,
  type PmCandidate,
  type PmChoice
} from './project-model'

function Failure({
  error
}: {
  error: Extract<ActionResult, { ok: false }> | null
}): React.JSX.Element | null {
  if (!error) return null
  return (
    <div role="alert" className="error modal__error">
      <p>{error.message}</p>
      {error.detail ? <p className="hint">{error.detail}</p> : null}
    </div>
  )
}

/** 확인이 필요한 변경(보관, 복원, PM 해제). 되돌릴 수 있는 변경이라 취소 버튼에 먼저 포커스를 둔다. */
export function ConfirmDialog({
  title,
  confirmLabel,
  busy,
  error,
  onConfirm,
  onCancel,
  children
}: {
  title: string
  confirmLabel: string
  busy: boolean
  error: Extract<ActionResult, { ok: false }> | null
  onConfirm: () => void
  onCancel: () => void
  children: React.ReactNode
}): React.JSX.Element {
  const titleId = useId()
  return (
    <Modal labelledBy={titleId} busy={busy} onClose={onCancel}>
      <h2 id={titleId} className="modal__title">
        {title}
      </h2>
      <div className="modal__body">{children}</div>
      <Failure error={error} />
      <div className="modal__actions">
        <Button autoFocus aria-disabled={busy} onClick={() => !busy && onCancel()}>
          취소
        </Button>
        <Button variant="primary" aria-disabled={busy} onClick={() => !busy && onConfirm()}>
          {busy ? '처리하는 중…' : confirmLabel}
        </Button>
      </div>
    </Modal>
  )
}

export function RenameDialog({
  current,
  busy,
  error,
  onSubmit,
  onCancel
}: {
  current: string
  busy: boolean
  error: Extract<ActionResult, { ok: false }> | null
  onSubmit: (name: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const titleId = useId()
  const inputId = useId()
  const errId = useId()
  const [name, setName] = useState(current)
  const invalid = checkProjectName(name)
  return (
    <Modal labelledBy={titleId} busy={busy} onClose={onCancel}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!busy && !invalid && name !== current) onSubmit(name)
        }}
      >
        <h2 id={titleId} className="modal__title">
          프로젝트 이름 수정
        </h2>
        <div className="modal__body">
          <div className="field">
            <label htmlFor={inputId}>이름 (1~{MAX_PROJECT_NAME}자)</label>
            <Input
              id={inputId}
              value={name}
              autoFocus
              autoComplete="off"
              aria-invalid={invalid !== null}
              aria-describedby={errId}
              onChange={(e) => setName(e.target.value)}
            />
            <p id={errId} className={invalid ? 'error' : 'hint'}>
              {invalid ?? '이름만 바뀌어요. 티켓과 배정이 참조하는 식별자(id)는 그대로예요.'}
            </p>
          </div>
        </div>
        <Failure error={error} />
        <div className="modal__actions">
          <Button aria-disabled={busy} onClick={() => !busy && onCancel()}>
            취소
          </Button>
          <Button
            variant="primary"
            type="submit"
            aria-disabled={busy || invalid !== null || name === current}
          >
            {busy ? '저장하는 중…' : '저장'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

/** 담당 PM 지정·변경. 후보가 없으면 인사팀 채용이 기본이다. */
export function PmDialog({
  projectName,
  pms,
  currentPmId,
  busy,
  error,
  onSubmit,
  onCancel
}: {
  projectName: string
  pms: readonly PmCandidate[]
  currentPmId: string | null
  busy: boolean
  error: Extract<ActionResult, { ok: false }> | null
  onSubmit: (choice: PmChoice) => void
  onCancel: () => void
}): React.JSX.Element {
  const titleId = useId()
  const [choice, setChoice] = useState<PmChoice>(() =>
    currentPmId && pms.some((p) => p.id === currentPmId)
      ? { kind: 'existing', id: currentPmId }
      : defaultPmChoice(pms)
  )
  return (
    <Modal labelledBy={titleId} busy={busy} onClose={onCancel}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!busy) onSubmit(choice)
        }}
      >
        <h2 id={titleId} className="modal__title">
          담당 PM {currentPmId ? '변경' : '지정'}
        </h2>
        <p className="modal__body">
          <strong>{projectName}</strong>의 담당 PM을 골라 주세요.
        </p>
        <PmFields
          pms={pms}
          choice={choice}
          disabled={busy}
          allowLater={false}
          onChange={setChoice}
        />
        <Failure error={error} />
        <div className="modal__actions">
          <Button aria-disabled={busy} onClick={() => !busy && onCancel()}>
            취소
          </Button>
          <Button variant="primary" type="submit" aria-disabled={busy || choice.kind === 'later'}>
            {busy ? '처리하는 중…' : choice.kind === 'hire' ? '채용하고 지정' : '지정'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

type PickResult = { path: string } | { error: string } | null

/** 프로젝트 추가: 1단계 폴더·이름·유형, 2단계 담당 PM. 경로는 폴더 선택 창이 돌려준 값만 쓴다. */
export function AddProjectDialog({
  pms,
  onPickFolder,
  onSubmit,
  onCancel
}: {
  pms: readonly PmCandidate[]
  onPickFolder: () => Promise<PickResult>
  onSubmit: (input: AddInput) => Promise<AddOutcome>
  onCancel: () => void
}): React.JSX.Element {
  const titleId = useId()
  const ids = { name: useId(), type: useId(), nameErr: useId() }
  const [step, setStep] = useState<1 | 2>(1)
  const [path, setPath] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [nameTouched, setNameTouched] = useState(false)
  const [type, setType] = useState<ProjectType>('development')
  const [pm, setPm] = useState<PmChoice>(() => defaultPmChoice(pms))
  const [busy, setBusy] = useState(false)
  const [picking, setPicking] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const errors = validateAddForm({ name })
  const showNameError = (nameTouched || name !== '') && errors.name
  const canNext = path !== null && Object.keys(errors).length === 0

  const pick = async (): Promise<void> => {
    setPicking(true)
    setMessage(null)
    const r = await onPickFolder()
    setPicking(false)
    if (r === null) return
    if ('error' in r) return setMessage(r.error)
    setPath(r.path)
    if (name === '') setName(suggestName(r.path))
  }

  const submit = async (): Promise<void> => {
    if (path === null || busy) return
    setBusy(true)
    setMessage(null)
    const outcome = await onSubmit({ path, name, type, pm })
    // done/partial이면 부모가 이 대화를 닫으므로 오류일 때만 돌아온다.
    if (outcome.kind === 'error') {
      setBusy(false)
      setMessage(outcome.message)
      // 폴더나 이름 문제일 수 있어 1단계로 돌려 고칠 수 있게 한다.
      setStep(1)
    }
  }

  return (
    <Modal labelledBy={titleId} busy={busy} onClose={onCancel}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (step === 1 && canNext) setStep(2)
          else if (step === 2) void submit()
        }}
      >
        <h2 id={titleId} className="modal__title">
          프로젝트 추가 <span className="hint">({step}/2)</span>
        </h2>
        {step === 1 ? (
          <div className="modal__body">
            <div className="field">
              <span id={`${titleId}-folder`}>폴더</span>
              <div className="field__row">
                <code className="code-box" aria-labelledby={`${titleId}-folder`}>
                  {path ?? '아직 고르지 않았어요'}
                </code>
                <Button aria-disabled={picking} onClick={() => !picking && void pick()}>
                  {path ? '다른 폴더' : '폴더 선택'}
                </Button>
              </div>
              <p className="hint">
                폴더는 선택 창에서만 고를 수 있어요. 새 폴더도 만들 수 있고, 폴더 안 파일은 바꾸지
                않아요.
              </p>
            </div>
            <div className="field">
              <label htmlFor={ids.name}>이름 (1~{MAX_PROJECT_NAME}자)</label>
              <Input
                id={ids.name}
                value={name}
                autoComplete="off"
                aria-invalid={Boolean(showNameError)}
                aria-describedby={ids.nameErr}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => setNameTouched(true)}
              />
              <p id={ids.nameErr} className={showNameError ? 'error' : 'hint'}>
                {showNameError || '화면에 보이는 이름이에요. 나중에 고칠 수 있어요.'}
              </p>
            </div>
            <div className="field">
              <label htmlFor={ids.type}>유형</label>
              <select
                id={ids.type}
                className="input"
                value={type}
                onChange={(e) => setType(e.target.value as ProjectType)}
              >
                {PROJECT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
              <p className="hint">
                {type === 'development'
                  ? '개발: git 레포 폴더(.git이 있는 최상위 폴더)여야 해요.'
                  : '콘텐츠·기타: 어떤 폴더든 괜찮아요.'}
              </p>
            </div>
          </div>
        ) : (
          <div className="modal__body">
            <p>
              <strong>{name}</strong>을(를) 맡을 PM을 정해 주세요.
            </p>
            <PmFields pms={pms} choice={pm} disabled={busy} onChange={setPm} />
          </div>
        )}
        <div role="status" aria-live="polite" className={busy ? 'hint' : 'visually-hidden'}>
          {busy && '프로젝트를 추가하고 있어요…'}
        </div>
        {message && (
          <p role="alert" className="error modal__error">
            {message}
          </p>
        )}
        <div className="modal__actions">
          <Button aria-disabled={busy} onClick={() => !busy && onCancel()}>
            취소
          </Button>
          {step === 2 && (
            <Button aria-disabled={busy} onClick={() => !busy && setStep(1)}>
              이전
            </Button>
          )}
          {step === 1 ? (
            <Button variant="primary" type="submit" aria-disabled={!canNext}>
              다음
            </Button>
          ) : (
            <Button variant="primary" type="submit" aria-disabled={busy}>
              {busy ? '추가하는 중…' : '프로젝트 추가'}
            </Button>
          )}
        </div>
      </form>
    </Modal>
  )
}
