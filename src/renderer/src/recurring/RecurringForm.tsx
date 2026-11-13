import { useId, useState } from 'react'
import {
  MAX_RECURRING_COUNT,
  WEEKDAY_CHARS,
  type RecurringDefinition
} from '../../../shared/recurring'
import type { ProjectInfo } from '../../../shared/project'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Modal } from '../ui/Modal'
import {
  CADENCE_KINDS,
  CADENCE_KIND_LABELS,
  draftOf,
  emptyDraft,
  validateDraft,
  type CadenceKind,
  type Draft,
  type DraftErrors
} from './recurring-model'

export interface Person {
  id: string
  name: string
}

/** 추가·수정 공용 폼. 저장 전 검증은 편의일 뿐이고 최종 검증은 main이 한다. */
export function RecurringForm({
  editing,
  projects,
  people,
  busy,
  error,
  onCancel,
  onSubmit
}: {
  editing: RecurringDefinition | null
  projects: readonly ProjectInfo[]
  people: readonly Person[]
  busy: boolean
  error: string | null
  onCancel: () => void
  onSubmit: (draft: Draft) => void
}): React.JSX.Element {
  const uid = useId()
  const [draft, setDraft] = useState<Draft>(() =>
    editing ? draftOf(editing) : emptyDraft(projects[0]?.id ?? '')
  )
  const [errors, setErrors] = useState<DraftErrors>({})
  const set = <K extends keyof Draft>(key: K, value: Draft[K]): void =>
    setDraft((d) => ({ ...d, [key]: value }))
  const id = (n: string): string => `${uid}-${n}`
  const titleId = id('heading')
  const err = (key: keyof DraftErrors): React.JSX.Element | null =>
    errors[key] ? (
      <p id={id(`${key}-err`)} role="alert" className="error">
        {errors[key]}
      </p>
    ) : null
  const describe = (key: keyof DraftErrors, hint?: string): string | undefined =>
    [errors[key] ? id(`${key}-err`) : null, hint ? id(`${key}-hint`) : null]
      .filter(Boolean)
      .join(' ') || undefined

  const submit = (e: React.FormEvent): void => {
    e.preventDefault()
    if (busy) return
    const found = validateDraft(draft)
    setErrors(found)
    if (Object.keys(found).length === 0) onSubmit(draft)
  }

  return (
    <Modal labelledBy={titleId} busy={busy} onClose={onCancel}>
      <h2 id={titleId} className="modal__title">
        {editing ? '반복 업무 수정' : '반복 업무 추가'}
      </h2>
      <form onSubmit={submit} noValidate className="rform">
        <div className="field">
          <label htmlFor={id('project')}>프로젝트</label>
          <select
            id={id('project')}
            className="input"
            value={draft.projectId}
            disabled={editing !== null}
            aria-invalid={errors.project ? true : undefined}
            aria-describedby={describe('project')}
            onChange={(e) => set('projectId', e.target.value)}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {err('project')}
        </div>
        <div className="field">
          <label htmlFor={id('title')}>티켓 제목</label>
          <Input
            id={id('title')}
            extraClass="rform__wide"
            value={draft.title}
            maxLength={300}
            autoFocus
            aria-invalid={errors.title ? true : undefined}
            aria-describedby={describe('title', 'hint')}
            onChange={(e) => set('title', e.target.value)}
          />
          <p id={id('title-hint')} className="hint">
            제목에 <code>{'{date}'}</code>를 쓰면 만들어지는 날짜(예: 2026-11-13)로 바뀌어요. 다른
            중괄호 표현은 글자 그대로 남아요.
          </p>
          {err('title')}
        </div>
        <div className="field">
          <label htmlFor={id('goal')}>목표</label>
          <Input
            id={id('goal')}
            extraClass="rform__wide"
            value={draft.goal}
            maxLength={2000}
            aria-invalid={errors.goal ? true : undefined}
            aria-describedby={describe('goal')}
            onChange={(e) => set('goal', e.target.value)}
          />
          {err('goal')}
        </div>
        <div className="field">
          <label htmlFor={id('criteria')}>완료 조건 (한 줄에 하나)</label>
          <textarea
            id={id('criteria')}
            className="input rform__wide rform__area"
            rows={3}
            value={draft.criteria}
            aria-invalid={errors.criteria ? true : undefined}
            aria-describedby={describe('criteria')}
            onChange={(e) => set('criteria', e.target.value)}
          />
          {err('criteria')}
        </div>
        <div className="field rform__row">
          <div>
            <label htmlFor={id('cadence')}>주기</label>
            <select
              id={id('cadence')}
              className="input"
              value={draft.cadenceKind}
              onChange={(e) => set('cadenceKind', e.target.value as CadenceKind)}
            >
              {CADENCE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {CADENCE_KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </div>
          {draft.cadenceKind === 'weekly' && (
            <div>
              <label htmlFor={id('day')}>요일</label>
              <select
                id={id('day')}
                className="input"
                value={draft.day}
                onChange={(e) => set('day', e.target.value as Draft['day'])}
              >
                {WEEKDAY_CHARS.map((d) => (
                  <option key={d} value={d}>
                    {d}요일
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label htmlFor={id('count')}>한 번에 만들 개수</label>
            <Input
              id={id('count')}
              type="number"
              min={1}
              max={MAX_RECURRING_COUNT}
              value={draft.count}
              aria-invalid={errors.count ? true : undefined}
              aria-describedby={describe('count')}
              onChange={(e) => set('count', e.target.value)}
            />
          </div>
        </div>
        {err('count')}
        <div className="field">
          <label htmlFor={id('assignee')}>담당</label>
          <select
            id={id('assignee')}
            className="input"
            value={draft.assignee}
            onChange={(e) => set('assignee', e.target.value)}
          >
            <option value="">프로젝트의 담당 PM</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <p className="hint">
            프로젝트에 배정되지 않은 직원을 고르면 담당 없이 만들어지고 경고가 남아요.
          </p>
        </div>
        {error && (
          <div role="alert" className="error modal__error">
            <p>{error}</p>
          </div>
        )}
        <div className="modal__actions">
          <Button aria-disabled={busy} onClick={() => !busy && onCancel()}>
            취소
          </Button>
          <Button type="submit" variant="primary" aria-disabled={busy}>
            {busy ? '저장하는 중…' : '저장'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
