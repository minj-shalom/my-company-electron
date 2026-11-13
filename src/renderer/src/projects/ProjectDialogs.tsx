import { useId, useState } from 'react'
import { MAX_PROJECT_NAME, checkProjectName } from '../../../shared/project'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { PmFields } from './PmFields'
import {
  defaultPmChoice,
  type ActionResult,
  type PmCandidate,
  type PmChoice
} from './project-model'

export function Failure({
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
