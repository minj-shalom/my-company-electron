import { useId } from 'react'
import type { ProjectTemplateInfo } from '../../../shared/project-template'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { rowStatus, type SetupProgress, type StaffRow } from './template-flow'

export type TemplateLoad =
  | { kind: 'loading' }
  | { kind: 'error' }
  | {
      kind: 'ready'
      templates: ProjectTemplateInfo[]
    }

export const NO_TEMPLATE = 'none'

/** 유형과 템플릿 선택. 라디오 그룹이라 방향키로 고르고 Tab으로 다음 칸으로 간다. */
export function TemplateStep({
  load,
  templates,
  selected,
  disabled,
  onSelect,
  onRetry
}: {
  load: TemplateLoad
  /** 고른 유형에 맞는 템플릿만. */
  templates: readonly ProjectTemplateInfo[]
  selected: string
  disabled: boolean
  onSelect: (id: string) => void
  onRetry: () => void
}): React.JSX.Element {
  const name = useId()
  return (
    <fieldset className="template-step" disabled={disabled}>
      <legend>시작 방법</legend>
      <p className="hint">
        프로젝트 종류에 맞는 기본 규칙과 추천 직원을 한 번에 준비해 드려요. 나중에 모두 바꿀 수
        있어요.
      </p>
      {load.kind === 'loading' && (
        <p role="status" className="hint">
          추천 구성을 불러오고 있어요…
        </p>
      )}
      {load.kind === 'error' && (
        <div role="alert" className="error">
          <p>추천 구성을 불러오지 못했어요. 템플릿 없이 시작할 수도 있어요.</p>
          <Button size="small" onClick={onRetry}>
            다시 시도
          </Button>
        </div>
      )}
      {load.kind === 'ready' && templates.length === 0 && (
        <p className="empty-state">이 유형에 맞는 추천 구성은 아직 없어요.</p>
      )}
      <ul className="template-cards">
        {templates.map((t) => (
          <li key={t.id} className="hire-card" data-selected={selected === t.id}>
            <label className="hire-card__label">
              <input
                type="radio"
                name={name}
                checked={selected === t.id}
                onChange={() => onSelect(t.id)}
              />
              <span className="hire-card__title">{t.title}</span>
            </label>
            <p className="hire-card__desc">{t.description}</p>
            <p className="hint">기본 규칙</p>
            <ul className="template-card__list">
              {t.policySummary.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
            <p className="hint">추천 직원</p>
            <ul className="template-card__list">
              {t.recommendedStaff.map((s) => (
                <li key={s.templateId}>
                  {s.isPm ? <Badge tone="info">담당 PM</Badge> : null} {s.reason}
                </li>
              ))}
            </ul>
          </li>
        ))}
        <li className="hire-card" data-selected={selected === NO_TEMPLATE}>
          <label className="hire-card__label">
            <input
              type="radio"
              name={name}
              checked={selected === NO_TEMPLATE}
              onChange={() => onSelect(NO_TEMPLATE)}
            />
            <span className="hire-card__title">템플릿 없이 시작</span>
          </label>
          <p className="hint">기본 규칙과 직원은 비워 두고, 담당 PM만 정해요.</p>
        </li>
      </ul>
    </fieldset>
  )
}

const STATUS_TEXT = { done: '완료', failed: '멈춤', pending: '대기' } as const

/** 추천 직원 확인. 체크한 직원만 채용·배정한다. 시작한 뒤에는 어디까지 됐는지 보여 준다. */
export function StaffStep({
  rows,
  checked,
  disabled,
  progress,
  onToggle
}: {
  rows: readonly StaffRow[]
  checked: ReadonlySet<string>
  disabled: boolean
  progress: SetupProgress | null
  onToggle: (templateId: string) => void
}): React.JSX.Element {
  const pmOff = rows.some((r) => r.isPm && !checked.has(r.templateId))
  const started = progress !== null && progress.projectId !== null
  return (
    <div className="staff-step">
      <fieldset disabled={disabled || started} className="pm-fields">
        <legend>추천 직원</legend>
        <p className="hint">
          이미 있는 직원은 그대로 쓰고, 없는 직원만 새로 채용해요. 빼고 싶은 사람은 체크를 풀어
          주세요.
        </p>
        <ul className="staff-list">
          {rows.map((r) => {
            const st = progress ? rowStatus(r, progress) : null
            return (
              <li key={r.templateId} className="staff-row">
                <label className="pm-fields__option">
                  <input
                    type="checkbox"
                    checked={checked.has(r.templateId)}
                    onChange={() => onToggle(r.templateId)}
                  />
                  <span>
                    {r.mode === 'reuse' ? r.name : r.title}
                    {r.isPm ? ' (담당 PM)' : ''}
                  </span>
                  <Badge tone={r.mode === 'reuse' ? 'good' : 'info'}>
                    {r.mode === 'reuse' ? '이미 있음, 그대로 사용' : '새로 채용'}
                  </Badge>
                  {started && checked.has(r.templateId) && st ? (
                    <Badge tone={st === 'done' ? 'good' : st === 'failed' ? 'bad' : 'neutral'}>
                      {STATUS_TEXT[st]}
                    </Badge>
                  ) : null}
                </label>
                <p className="hint pm-fields__hint">{r.reason}</p>
              </li>
            )
          })}
        </ul>
      </fieldset>
      {pmOff && (
        <p className="notice" role="note">
          담당 PM을 빼면 이 프로젝트는 &ldquo;PM 필요&rdquo; 상태로 남아 티켓이 실행되지 않아요.
        </p>
      )}
    </div>
  )
}
