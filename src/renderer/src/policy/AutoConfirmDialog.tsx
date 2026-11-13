import { useId, useState } from 'react'
import type { PolicyAction, PolicyValues } from '../../../shared/policy'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { ACTION_LABELS, describeAuto, hasProtectedTarget } from './policy-model'

/** 자동 모드를 켜거나 바꾸기 전 경고 대화. 확인 체크 전에는 켤 수 없다. 취소 버튼에 먼저 포커스를 둔다. */
export function AutoConfirmDialog({
  actions,
  draft,
  projectName,
  busy,
  onCancel,
  onConfirm
}: {
  actions: PolicyAction[]
  draft: PolicyValues
  projectName: string
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}): React.JSX.Element {
  const titleId = useId()
  const [checked, setChecked] = useState(false)
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
              <strong>{ACTION_LABELS[a]}</strong>: {describeAuto(a, draft)}
            </li>
          ))}
        </ul>
        {protectedMerge && (
          <p className="policy-mode__hint--danger">
            보호 브랜치 머지가 포함돼 있어요. 잘못 머지되면 바로 릴리스에 반영될 수 있어요.
          </p>
        )}
        <p className="hint">
          일일 상한, 감사 기록, 킬 스위치는 항상 적용돼요. 강제 푸시와 프로젝트 밖 쓰기는 자동
          모드에서도 안 돼요.
        </p>
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
