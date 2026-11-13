import { useId } from 'react'
import {
  APPROVAL_MODES,
  MAX_DAILY_LIMIT,
  PROTECTED_MERGE_MAX_DAILY,
  type LimitedAction,
  type PolicyAction,
  type PolicyValues
} from '../../../shared/policy'
import type { ProjectType } from '../../../shared/project'
import { Input } from '../ui/Input'
import {
  MODE_HINTS,
  MODE_LABELS,
  hasProtectedTarget,
  listText,
  parseList,
  setMode
} from './policy-model'
import { wordingFor } from './policy-wording'

type Edit = (v: PolicyValues) => void

/** 동작 하나의 승인 모드 라디오 묶음. 자동을 고르면 상한과 허용 대상 입력이 이어진다. */
export function ModeRow({
  action,
  draft,
  projectName,
  projectType,
  disabled,
  onChange
}: {
  action: PolicyAction
  draft: PolicyValues
  projectName: string
  projectType: ProjectType
  disabled: boolean
  onChange: Edit
}): React.JSX.Element {
  const name = useId()
  const w = wordingFor(projectType)
  const mode = draft.modes[action]
  return (
    <fieldset className="policy-mode" data-mode={mode} disabled={disabled}>
      <legend>{w.actions[action]}</legend>
      <div
        className="policy-mode__options"
        role="radiogroup"
        aria-label={`${w.actions[action]} 승인 모드`}
      >
        {APPROVAL_MODES.map((m) => (
          <label
            key={m}
            className={`policy-mode__option${m === 'auto' ? ' policy-mode__option--auto' : ''}`}
          >
            <input
              type="radio"
              name={name}
              value={m}
              checked={mode === m}
              onChange={() => onChange(setMode(draft, action, m))}
            />
            <span>{MODE_LABELS[m]}</span>
          </label>
        ))}
      </div>
      <p className={mode === 'auto' ? 'policy-mode__hint policy-mode__hint--danger' : 'hint'}>
        {MODE_HINTS[mode]}
      </p>
      {mode === 'auto' && (
        <AutoDetails
          action={action}
          draft={draft}
          projectName={projectName}
          projectType={projectType}
          onChange={onChange}
        />
      )}
    </fieldset>
  )
}

function AutoDetails({
  action,
  draft,
  projectName,
  projectType,
  onChange
}: {
  action: PolicyAction
  draft: PolicyValues
  projectName: string
  projectType: ProjectType
  onChange: Edit
}): React.JSX.Element | null {
  const id = useId()
  const w = wordingFor(projectType)
  const protectedMerge = action === 'merge' && hasProtectedTarget(draft.autoMergeBranches)
  const limited = action !== 'draft-approve'
  const max = protectedMerge ? PROTECTED_MERGE_MAX_DAILY : MAX_DAILY_LIMIT[action as LimitedAction]
  const confirmOk = draft.confirmInput === projectName
  if (!limited) return <p className="hint">초안이 CEO 승인 없이 곧바로 발행 단계로 넘어가요.</p>
  const limit = draft.dailyLimits[action as LimitedAction]
  return (
    <div className="policy-auto">
      <div className="field">
        <label htmlFor={`${id}-limit`}>하루 최대 횟수 (필수, {max} 이하)</label>
        <Input
          id={`${id}-limit`}
          type="number"
          inputMode="numeric"
          min={1}
          max={max}
          extraClass="policy-auto__num"
          value={limit ?? ''}
          onChange={(e) => {
            const next = { ...draft.dailyLimits }
            if (e.target.value === '') delete next[action as LimitedAction]
            else next[action as LimitedAction] = Number(e.target.value)
            onChange({ ...draft, dailyLimits: next })
          }}
        />
      </div>
      {action === 'push' && (
        <div className="field">
          <label htmlFor={`${id}-prefix`}>{w.pushPrefixLabel}</label>
          <Input
            id={`${id}-prefix`}
            placeholder="feature/"
            value={listText(draft.autoPushPrefixes)}
            onChange={(e) => onChange({ ...draft, autoPushPrefixes: parseList(e.target.value) })}
          />
          <p className="hint">{w.pushPrefixHint}</p>
        </div>
      )}
      {action === 'merge' && (
        <>
          <div className="field">
            <label htmlFor={`${id}-branches`}>{w.mergeTargetLabel}</label>
            <Input
              id={`${id}-branches`}
              placeholder="develop"
              value={listText(draft.autoMergeBranches)}
              onChange={(e) => onChange({ ...draft, autoMergeBranches: parseList(e.target.value) })}
            />
            <p className="hint">{w.mergeTargetHint}</p>
          </div>
          {protectedMerge && (
            <div className="field policy-protected" role="group" aria-label={w.protectedGroupLabel}>
              <p className="policy-mode__hint--danger">{w.protectedDanger}</p>
              <label htmlFor={`${id}-confirm`}>
                확인을 위해 프로젝트 이름 &ldquo;{projectName}&rdquo;을(를) 그대로 입력하세요
              </label>
              <Input
                id={`${id}-confirm`}
                autoComplete="off"
                aria-invalid={
                  draft.confirmInput !== null && draft.confirmInput !== '' && !confirmOk
                }
                value={draft.confirmInput ?? ''}
                onChange={(e) => onChange({ ...draft, confirmInput: e.target.value })}
              />
              {confirmOk && <p className="hint">이름이 일치해요.</p>}
            </div>
          )}
        </>
      )}
    </div>
  )
}
