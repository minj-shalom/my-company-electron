import { useId, useState } from 'react'
import type { PolicyAction, PolicyValues } from '../../../shared/policy'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import type { ProjectType } from '../../../shared/project'
import { describeAuto, hasProtectedTarget } from './policy-model'
import { wordingFor } from './policy-wording'

/** 자동 모드를 켜거나 바꾸기 전 경고 대화. 확인 체크 전에는 켤 수 없다. 취소 버튼에 먼저 포커스를 둔다. */
export function AutoConfirmDialog({
  actions,
  draft,
  projectName,
  projectType,
  busy,
  onCancel,
  onConfirm
}: {
  actions: PolicyAction[]
  draft: PolicyValues
  projectName: string
  projectType: ProjectType
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}): React.JSX.Element {
  const titleId = useId()
  const [checked, setChecked] = useState(false)
  const w = wordingFor(projectType)
  const protectedMerge = actions.includes('merge') && hasProtectedTarget(draft.autoMergeBranches)
  return (
    <Modal labelledBy={titleId} busy={busy} onClose={onCancel}>
      <h2 id={titleId} className="modal__title policy__danger-title">
        자동 모드를 켤까요?
      </h2>
      <div className="modal__body">
        <p>
          <strong>{projectName}</strong>에서 아래 동작이 <strong>CEO 컨펌 없이</strong> 일어나요.
        </p>
        <ul className="policy__danger-list">
          {actions.map((a) => (
            <li key={a}>
              <strong>{w.actions[a]}</strong>: {describeAuto(a, draft, projectType)}
            </li>
          ))}
        </ul>
        {protectedMerge && <p className="policy-mode__hint--danger">{w.autoProtectedWarn}</p>}
        <p className="hint">{w.autoConfirmForce}</p>
        <label className="policy__check">
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
          <span>위 내용을 이해했고, 이 프로젝트에 자동 모드를 켭니다.</span>
        </label>
      </div>
      <div className="modal__actions">
        <Button autoFocus aria-disabled={busy} onClick={() => !busy && onCancel()}>
          취소
        </Button>
        <Button
          variant="primary"
          aria-disabled={busy || !checked}
          onClick={() => checked && !busy && onConfirm()}
        >
          {busy ? '저장하는 중…' : '자동 모드 켜고 저장'}
        </Button>
      </div>
    </Modal>
  )
}
