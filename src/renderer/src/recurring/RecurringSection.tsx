import { useId, useRef, useState } from 'react'
import { MAX_RECURRING_DEFS, type RecurringItem } from '../../../shared/recurring'
import type { ProjectInfo } from '../../../shared/project'
import { ConfirmDialog } from '../projects/ProjectDialogs'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Panel } from '../ui/Panel'
import { RecurringForm, type Person } from './RecurringForm'
import {
  TOO_MANY,
  cadenceLabel,
  goalNotes,
  newRecurringId,
  nextRunText,
  projectName,
  runRecurringAction,
  toDefinition,
  type Draft,
  type GoalNote,
  type RecurringLoad
} from './recurring-model'
import type { UseRecurring } from './use-recurring'

type Dialog = { kind: 'add' } | { kind: 'edit' | 'remove'; item: RecurringItem } | null

export interface RecurringSectionProps extends UseRecurring {
  projects: readonly ProjectInfo[]
  people: readonly Person[]
}

/** 프로젝트 화면의 "반복 업무" 구역. 정의만 다루고 티켓은 앱이 자동 점검 때 만든다. */
export function RecurringSection({
  load,
  goals,
  refreshing,
  reload,
  projects,
  people,
  now
}: RecurringSectionProps): React.JSX.Element {
  const headingId = useId()
  const [dialog, setDialog] = useState<Dialog>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const lock = useRef(false)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const usable = projects.filter((p) => p.status === 'active')
  const count = load.kind === 'ready' ? load.list.items.length : 0

  const close = (): void => {
    setDialog(null)
    setError(null)
    queueMicrotask(() => {
      if (document.activeElement === document.body) headingRef.current?.focus()
    })
  }
  const run = async (
    task: () => ReturnType<typeof runRecurringAction>,
    keepOpen = false
  ): Promise<void> => {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError(null)
    try {
      const r = await task()
      if (r.ok) {
        setNotice(r.message)
        reload()
        if (!keepOpen) close()
      } else if (keepOpen) setNotice(r.message)
      else setError(r.message)
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  const save = (draft: Draft): void => {
    const editing = dialog?.kind === 'edit' ? dialog.item : null
    const existing = new Set(load.kind === 'ready' ? load.list.items.map((i) => i.id) : [])
    const def = toDefinition(
      draft,
      editing?.id ?? newRecurringId(existing),
      editing?.status ?? 'active'
    )
    void run(() =>
      runRecurringAction(
        () => (editing ? window.api.updateRecurring(def) : window.api.addRecurring(def)),
        editing ? '반복 업무를 수정했어요.' : '반복 업무를 추가했어요.'
      )
    )
  }

  const atLimit = count >= MAX_RECURRING_DEFS
  const canAdd = load.kind === 'ready' && usable.length > 0 && !atLimit

  return (
    <section className="recurring" aria-labelledby={headingId}>
      <div className="projects__head">
        <h2 id={headingId} tabIndex={-1} ref={headingRef}>
          반복 업무
        </h2>
        <Button
          variant="primary"
          size="small"
          aria-disabled={!canAdd}
          onClick={() => canAdd && setDialog({ kind: 'add' })}
        >
          반복 업무 추가
        </Button>
      </div>
      <p className="hint projects__lead">
        정해진 주기마다 티켓을 자동으로 만들어요. 앱이 꺼져 있던 동안 밀린 날은 만들지 않고 그날
        몫만 만들어요. 만든 티켓은 일반 티켓과 똑같이 사용량 한도와 프로젝트 설정을 따라요.
      </p>
      {atLimit && <p className="hint">{TOO_MANY}</p>}
      {load.kind === 'ready' && usable.length === 0 && (
        <p className="hint">반복 업무를 추가하려면 먼저 프로젝트가 하나 있어야 해요.</p>
      )}
      <div role="status" aria-live="polite" className={refreshing ? 'hint' : 'visually-hidden'}>
        {refreshing && '반복 업무를 불러오고 있어요…'}
      </div>
      {notice && (
        <div className="notice projects__notice" role="status">
          <span>{notice}</span>
          <Button size="small" onClick={() => setNotice(null)}>
            닫기
          </Button>
        </div>
      )}
      <RecurringBody
        load={load}
        goals={goals}
        projects={projects}
        people={people}
        now={now}
        busy={busy}
        onRetry={reload}
        onAdd={() => canAdd && setDialog({ kind: 'add' })}
        onEdit={(item) => setDialog({ kind: 'edit', item })}
        onRemove={(item) => setDialog({ kind: 'remove', item })}
        onToggle={(item) =>
          void run(
            () =>
              runRecurringAction(
                () =>
                  window.api.setRecurringStatus({
                    id: item.id,
                    status: item.status === 'active' ? 'paused' : 'active'
                  }),
                item.status === 'active' ? '일시정지했어요.' : '다시 시작했어요.'
              ),
            true
          )
        }
      />
      {(dialog?.kind === 'add' || dialog?.kind === 'edit') && (
        <RecurringForm
          editing={dialog.kind === 'edit' ? dialog.item : null}
          projects={usable}
          people={people}
          busy={busy}
          error={error}
          onCancel={close}
          onSubmit={save}
        />
      )}
      {dialog?.kind === 'remove' && (
        <ConfirmDialog
          title="반복 업무 삭제"
          confirmLabel="삭제"
          busy={busy}
          error={error === null ? null : { ok: false, message: error }}
          onCancel={close}
          onConfirm={() => {
            const id = dialog.item.id
            void run(() =>
              runRecurringAction(
                () => window.api.removeRecurring({ id }),
                '반복 업무를 삭제했어요.'
              )
            )
          }}
        >
          <p>
            <strong>{dialog.item.titleTemplate}</strong> 반복 업무를 삭제할까요?
          </p>
          <p>이미 만든 티켓은 남아요. 앞으로 새 티켓이 만들어지지 않을 뿐이에요.</p>
        </ConfirmDialog>
      )}
    </section>
  )
}

function RecurringBody({
  load,
  goals,
  projects,
  people,
  now,
  busy,
  onRetry,
  onAdd,
  onEdit,
  onRemove,
  onToggle
}: {
  load: RecurringLoad
  goals: ReadonlyMap<string, number>
  projects: readonly ProjectInfo[]
  people: readonly Person[]
  now: number
  busy: boolean
  onRetry: () => void
  onAdd: () => void
  onEdit: (i: RecurringItem) => void
  onRemove: (i: RecurringItem) => void
  onToggle: (i: RecurringItem) => void
}): React.JSX.Element | null {
  if (load.kind === 'loading')
    return (
      <p className="hint" role="status">
        반복 업무를 불러오고 있어요…
      </p>
    )
  if (load.kind === 'error')
    return (
      <Panel>
        <p role="alert" className="error">
          {load.message}
        </p>
        <Button onClick={onRetry}>다시 시도</Button>
      </Panel>
    )
  const { items, unreadable, overLimit } = load.list
  const notes = goalNotes(items, goals)
  const ids = [...new Set(items.map((i) => i.projectId))]
  return (
    <>
      {unreadable > 0 && (
        <p className="notice" role="status">
          읽지 못한 반복 업무 {unreadable}건은 건너뛰었어요. 형식이 올바르지 않은 항목이에요.
        </p>
      )}
      {overLimit > 0 && (
        <p className="notice" role="status">
          반복 업무가 {MAX_RECURRING_DEFS}개를 넘어 {overLimit}건은 티켓을 만들지 않아요. 안 쓰는
          것을 삭제해 주세요.
        </p>
      )}
      {items.length === 0 ? (
        <Panel>
          <p className="empty-state">아직 반복 업무가 없어요</p>
          <p className="hint">
            예를 들어 &ldquo;블로그 글 {'{date}'}&rdquo;을 매일 하나씩 만들도록 정해 둘 수 있어요.
          </p>
          <div className="projects__empty-actions">
            <Button variant="primary" aria-disabled={projects.length === 0} onClick={onAdd}>
              첫 반복 업무 추가
            </Button>
          </div>
        </Panel>
      ) : (
        ids.map((projectId) => (
          <ProjectGroup
            key={projectId}
            project={projects.find((p) => p.id === projectId)}
            projectId={projectId}
            note={notes.get(projectId)}
            items={items.filter((i) => i.projectId === projectId)}
            people={people}
            now={now}
            busy={busy}
            onEdit={onEdit}
            onRemove={onRemove}
            onToggle={onToggle}
          />
        ))
      )}
    </>
  )
}

function ProjectGroup({
  project,
  projectId,
  note,
  items,
  people,
  now,
  busy,
  onEdit,
  onRemove,
  onToggle
}: {
  project: ProjectInfo | undefined
  projectId: string
  note: GoalNote | undefined
  items: RecurringItem[]
  people: readonly Person[]
  now: number
  busy: boolean
  onEdit: (i: RecurringItem) => void
  onRemove: (i: RecurringItem) => void
  onToggle: (i: RecurringItem) => void
}): React.JSX.Element {
  const name = projectName(project ? [project] : [], projectId)
  const blocked = project === undefined || project.state !== 'ready'
  return (
    <div className="recurring__group">
      <h3 className="recurring__project">{name}</h3>
      {project?.state === 'pm-required' && (
        <p className="notice" role="note">
          이 프로젝트는 PM이 없어서 반복 업무의 티켓이 만들어지지 않아요. 담당 PM을 정하면 다시
          만들어져요.
        </p>
      )}
      {project?.state === 'archived' && (
        <p className="notice" role="note">
          보관된 프로젝트라 티켓이 만들어지지 않아요. 복원하면 다시 만들어져요.
        </p>
      )}
      {project === undefined && (
        <p className="notice" role="note">
          프로젝트를 찾을 수 없어 티켓이 만들어지지 않아요.
        </p>
      )}
      {note && note.goal > 0 && (
        <p className={note.mismatch ? 'notice' : 'hint'} role={note.mismatch ? 'note' : undefined}>
          하루 목표는 {note.goal}건이고, 매일·평일 반복 업무는 하루 {note.perDay}건을 만들어요.
          {note.mismatch && ' 개수가 달라요. 목표나 반복 업무 개수를 맞춰 보세요.'}
        </p>
      )}
      <ul className="recurring__list" aria-label={`${name} 반복 업무`}>
        {items.map((item) => {
          const who = item.assignee
            ? (people.find((p) => p.id === item.assignee)?.name ?? '알 수 없는 직원')
            : '프로젝트의 담당 PM'
          const label = (verb: string): string => `${item.titleTemplate} ${verb}`
          return (
            <li key={item.id} className="recurring__item" data-status={item.status}>
              <div className="project-card__head">
                <h4 className="project-card__name">{item.titleTemplate}</h4>
                <Badge tone={item.status === 'active' ? 'good' : 'neutral'}>
                  {item.status === 'active' ? '진행 중' : '일시정지'}
                </Badge>
                {blocked && item.status === 'active' && (
                  <Badge tone="warn">지금은 안 만들어져요</Badge>
                )}
              </div>
              <dl className="project-card__meta">
                <dt>주기</dt>
                <dd>
                  {cadenceLabel(item.cadence)}, 한 번에 {item.count}건
                </dd>
                <dt>담당</dt>
                <dd>{who}</dd>
                <dt>다음 생성</dt>
                <dd>
                  {blocked && item.status === 'active'
                    ? '만들 수 없는 상태예요'
                    : nextRunText(item, now)}
                </dd>
              </dl>
              <div className="project-card__actions">
                <Button size="small" aria-label={label('수정')} onClick={() => onEdit(item)}>
                  수정
                </Button>
                <Button
                  size="small"
                  aria-label={label(item.status === 'active' ? '일시정지' : '다시 시작')}
                  aria-disabled={busy}
                  onClick={() => !busy && onToggle(item)}
                >
                  {item.status === 'active' ? '일시정지' : '다시 시작'}
                </Button>
                <Button size="small" aria-label={label('삭제')} onClick={() => onRemove(item)}>
                  삭제
                </Button>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
