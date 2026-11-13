import { useId } from 'react'
import {
  APPROVAL_MODES,
  MAX_DAILY_LIMIT,
  PROTECTED_MERGE_MAX_DAILY,
  type LimitedAction,
  type PolicyAction,
  type PolicyValues
} from '../../../shared/policy'
import { Input } from '../ui/Input'
import {
  ACTION_LABELS,
  MODE_HINTS,
  MODE_LABELS,
  hasProtectedTarget,
  listText,
  parseList,
  setMode
} from './policy-model'

type Edit = (v: PolicyValues) => void

/** 동작 하나의 승인 모드 라디오 묶음. 자동을 고르면 상한과 허용 대상 입력이 이어진다. */
export function ModeRow({
  action,
  draft,
  projectName,
  disabled,
  onChange
}: {
  action: PolicyAction
  draft: PolicyValues
  projectName: string
  disabled: boolean
  onChange: Edit
}): React.JSX.Element {
  const name = useId()
  const mode = draft.modes[action]
  return (
    <fieldset className="policy-mode" data-mode={mode} disabled={disabled}>
      <legend>{ACTION_LABELS[action]}</legend>
      <div
        className="policy-mode__options"
        role="radiogroup"
        aria-label={`${ACTION_LABELS[action]} 승인 모드`}
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
        <AutoDetails action={action} draft={draft} projectName={projectName} onChange={onChange} />
      )}
    </fieldset>
  )
}

function AutoDetails({
  action,
  draft,
  projectName,
  onChange
}: {
  action: PolicyAction
  draft: PolicyValues
  projectName: string
  onChange: Edit
}): React.JSX.Element | null {
  const id = useId()
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
          <label htmlFor={`${id}-prefix`}>자동 푸시를 허용할 브랜치 접두어</label>
          <Input
            id={`${id}-prefix`}
            placeholder="feature/"
            value={listText(draft.autoPushPrefixes)}
            onChange={(e) => onChange({ ...draft, autoPushPrefixes: parseList(e.target.value) })}
          />
          <p className="hint">
            쉼표로 여러 개를 적을 수 있어요. master, main 같은 보호 브랜치는 안 돼요.
          </p>
        </div>
      )}
      {action === 'merge' && (
        <>
          <div className="field">
            <label htmlFor={`${id}-branches`}>자동 머지를 허용할 브랜치 (이름으로 정확히)</label>
            <Input
              id={`${id}-branches`}
              placeholder="develop"
              value={listText(draft.autoMergeBranches)}
              onChange={(e) => onChange({ ...draft, autoMergeBranches: parseList(e.target.value) })}
            />
            <p className="hint">PR이 있고 reviewer-qa 검수를 통과한 것만 머지돼요.</p>
          </div>
          {protectedMerge && (
            <div className="field policy-protected" role="group" aria-label="보호 브랜치 확인">
              <p className="policy-mode__hint--danger">
                보호 브랜치(master, main 등)에 컨펌 없이 머지돼요. 릴리스에 바로 반영될 수 있어요.
                하루 1~2회까지만 허용돼요.
              </p>
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
