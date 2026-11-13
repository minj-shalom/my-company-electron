import { useId, useRef, useState } from 'react'
import type { OrgSnapshot } from '../../../shared/org'
import type { PolicySummary } from '../../../shared/policy'
import type { ProjectInfo } from '../../../shared/project'
import { PolicyDialog } from '../policy/PolicyDialog'
import { usePolicySummaries } from '../policy/use-policy'
import { UnassignedSection } from '../assign/UnassignedSection'
import { useOrg } from '../org/use-org'
import { AutoRunLog } from '../gate/AutoRunLog'
import type { AuditLoad } from '../gate/use-audit-summary'
import type { UseKillSwitch } from '../gate/use-kill-switch'
import { Button } from '../ui/Button'
import { Panel } from '../ui/Panel'
import { UnreadableNotice } from '../ui/UnreadableNotice'
import { AddProjectDialog, ConfirmDialog, PmDialog, RenameDialog } from './ProjectDialogs'
import { ProjectCard, type ProjectAction } from './ProjectCard'
import {
  LEGACY_NOTE,
  addProjectFlow,
  archiveProject,
  assignPm,
  clearPm,
  pickFolder,
  rankPms,
  unreadableLabel,
  renameProject,
  restoreProject,
  type ActionResult,
  type PmChoice
} from './project-model'
import type { UseProjects } from './use-projects'

type Dialog = { kind: 'add' } | { kind: ProjectAction; project: ProjectInfo } | null

type Failed = Extract<ActionResult, { ok: false }>

export interface ProjectsViewProps extends UseProjects {
  /** 상단 "현재 프로젝트" 선택. 보기 필터일 뿐이다. */
  currentId: string | null
  /** 자동 실행 기록과 프로젝트별 중지. 없으면 그 구역을 보이지 않는다. */
  gate?: { ks: UseKillSwitch; audit: AuditLoad; onReload: () => void }
}

/** 프로젝트 탭: 목록, 추가, 이름 수정, 보관/복원, 담당 PM. 변경은 모두 window.api 경유이고 끝나면 목록을 다시 읽는다. */
export function ProjectsView({
  load,
  refreshing,
  reload,
  currentId,
  gate
}: ProjectsViewProps): React.JSX.Element {
  const [dialog, setDialog] = useState<Dialog>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<Failed | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const lock = useRef(false)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const org = useOrg()
  const policies = usePolicySummaries()
  const orgSnapshot = org.status.kind === 'ready' ? org.status.snapshot : null
  const people = {
    org: orgSnapshot,
    onChanged: () => {
      org.refresh()
      reload()
    }
  }
  const loading = load.kind === 'loading' || refreshing

  const close = (): void => {
    setDialog(null)
    setError(null)
    // 처리한 항목이 목록에서 사라지면 브라우저가 포커스를 돌려줄 곳이 없어 제목으로 옮긴다.
    queueMicrotask(() => {
      if (document.activeElement === document.body) headingRef.current?.focus()
    })
  }

  const run = async (task: () => Promise<ActionResult>): Promise<void> => {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError(null)
    try {
      const r = await task()
      if (r.ok) {
        setNotice(r.message)
        reload()
        close()
      } else setError(r)
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  const onAction = (action: ProjectAction, project: ProjectInfo): void => {
    setError(null)
    setDialog({ kind: action, project })
  }

  const items = load.kind === 'ready' ? load.list.items : []
  const pms = load.kind === 'ready' ? rankPms(load.pms, items) : []
  const active = items.filter((p) => p.status === 'active')
  const archived = items.filter((p) => p.status === 'archived')

  return (
    <section className="projects" aria-labelledby="projects-heading">
      <div className="projects__head">
        <h2 id="projects-heading" tabIndex={-1} ref={headingRef}>
          프로젝트
        </h2>
        <Button
          variant="primary"
          size="small"
          aria-disabled={load.kind !== 'ready'}
          onClick={() => load.kind === 'ready' && setDialog({ kind: 'add' })}
        >
          프로젝트 추가
        </Button>
        <Button size="small" aria-disabled={loading} onClick={() => !loading && reload()}>
          다시 불러오기
        </Button>
      </div>
      <p className="hint projects__lead">
        회사가 소유한 프로젝트 목록이에요. 직원과 예산은 회사 단위이고, 프로젝트는 폴더만 가리켜요.
        보관해도 폴더는 지워지지 않아요.
      </p>
      <div role="status" aria-live="polite" className={loading ? 'hint' : 'visually-hidden'}>
        {loading && '프로젝트를 불러오고 있어요…'}
      </div>
      {notice && (
        <div className="notice projects__notice" role="status">
          <span>{notice}</span>
          <Button size="small" onClick={() => setNotice(null)}>
            닫기
          </Button>
        </div>
      )}
      <ProjectsBody
        load={load}
        active={active}
        archived={archived}
        currentId={currentId}
        onAction={onAction}
        people={people}
        policies={policies.byId}
        onRetry={reload}
        onAdd={() => setDialog({ kind: 'add' })}
      />
      {load.kind === 'ready' && gate && (
        <AutoRunLog projects={active} audit={gate.audit} onReload={gate.onReload} ks={gate.ks} />
      )}
      {load.kind === 'ready' && (
        <UnassignedSection org={orgSnapshot} failed={org.status.kind === 'error'} />
      )}

      {dialog?.kind === 'add' && load.kind === 'ready' && (
        <AddProjectDialog
          pms={pms}
          onCancel={close}
          onPickFolder={() => pickFolder(window.api)}
          onSubmit={async (input) => {
            const outcome = await addProjectFlow(window.api, input)
            if (outcome.kind !== 'error') {
              setNotice(outcome.message)
              reload()
              close()
            }
            return outcome
          }}
        />
      )}
      {dialog?.kind === 'policy' && (
        <PolicyDialog
          projectId={dialog.project.id}
          projectName={dialog.project.name}
          projectType={dialog.project.type}
          onClose={close}
          onSaved={policies.reload}
        />
      )}
      {dialog?.kind === 'rename' && (
        <RenameDialog
          current={dialog.project.name}
          busy={busy}
          error={error}
          onCancel={close}
          onSubmit={(name) => void run(() => renameProject(window.api, dialog.project.id, name))}
        />
      )}
      {dialog?.kind === 'assign-pm' && (
        <PmDialog
          projectName={dialog.project.name}
          pms={pms}
          currentPmId={dialog.project.pm?.id ?? null}
          busy={busy}
          error={error}
          onCancel={close}
          onSubmit={(choice: PmChoice) =>
            void run(() => assignPm(window.api, dialog.project, choice))
          }
        />
      )}
      {dialog?.kind === 'clear-pm' && (
        <ConfirmDialog
          title="담당 PM 해제"
          confirmLabel="해제"
          busy={busy}
          error={error}
          onCancel={close}
          onConfirm={() => void run(() => clearPm(window.api, dialog.project.id))}
        >
          <p>
            <strong>{dialog.project.name}</strong>의 담당 PM을 해제할까요?
          </p>
          <p>PM이 없으면 이 프로젝트의 티켓이 실행되지 않아요. 언제든 다시 지정할 수 있어요.</p>
        </ConfirmDialog>
      )}
      {dialog?.kind === 'archive' && (
        <ConfirmDialog
          title="프로젝트 보관"
          confirmLabel="보관"
          busy={busy}
          error={error}
          onCancel={close}
          onConfirm={() => void run(() => archiveProject(window.api, dialog.project.id))}
        >
          <p>
            <strong>{dialog.project.name}</strong>을(를) 보관할까요?
          </p>
          <p>폴더는 지워지지 않아요. 목록에서 보관됨으로 옮겨질 뿐이고 언제든 복원할 수 있어요.</p>
        </ConfirmDialog>
      )}
      {dialog?.kind === 'restore' && (
        <ConfirmDialog
          title="프로젝트 복원"
          confirmLabel="복원"
          busy={busy}
          error={error}
          onCancel={close}
          onConfirm={() => void run(() => restoreProject(window.api, dialog.project.id))}
        >
          <p>
            <strong>{dialog.project.name}</strong>을(를) 다시 활성 프로젝트로 돌릴까요?
          </p>
          <p>폴더는 그대로예요. 담당 PM이 없으면 &ldquo;PM 필요&rdquo; 상태로 돌아와요.</p>
        </ConfirmDialog>
      )}
    </section>
  )
}

function ProjectsBody({
  load,
  active,
  archived,
  currentId,
  onAction,
  people,
  policies,
  onRetry,
  onAdd
}: {
  load: UseProjects['load']
  active: ProjectInfo[]
  archived: ProjectInfo[]
  currentId: string | null
  onAction: (a: ProjectAction, p: ProjectInfo) => void
  people: { org: OrgSnapshot | null; onChanged: () => void }
  policies: Map<string, PolicySummary>
  onRetry: () => void
  onAdd: () => void
}): React.JSX.Element | null {
  const archivedId = useId()
  const [showArchived, setShowArchived] = useState(false)
  // 보관된 프로젝트만 남으면 펼쳐서 보여 준다 (비어 보이지 않게).
  const open = showArchived || active.length === 0

  if (load.kind === 'loading') return null
  if (load.kind === 'error')
    return (
      <Panel>
        <p role="alert" className="error">
          {load.message}
        </p>
        <Button onClick={onRetry}>다시 시도</Button>
      </Panel>
    )
  const { list } = load
  const total = active.length + archived.length
  return (
    <>
      {list.format === 'legacy' && (
        <p className="notice" role="note">
          {LEGACY_NOTE}
        </p>
      )}
      <UnreadableNotice
        items={list.unreadable.map((u) => ({
          path: unreadableLabel(u.line),
          reason: u.reason
        }))}
        summary={(n) => `읽지 못한 프로젝트 블록 ${n}건`}
        reasonText={() => '형식이 올바르지 않아 건너뛰었어요'}
      />
      {total === 0 ? (
        <Panel>
          <p className="empty-state">아직 등록한 프로젝트가 없어요</p>
          <div className="projects__empty-actions">
            <Button variant="primary" onClick={onAdd}>
              첫 프로젝트 추가
            </Button>
          </div>
        </Panel>
      ) : (
        <>
          <ul className="project-list" aria-label="활성 프로젝트">
            {active.map((p) => (
              <ProjectCard
                key={p.id}
                project={p}
                current={p.id === currentId}
                onAction={onAction}
                people={people}
                policy={policies.get(p.id)}
              />
            ))}
          </ul>
          {active.length === 0 && (
            <p className="hint">
              활성 프로젝트가 없어요. 보관된 프로젝트를 복원하거나 새로 추가해 보세요.
            </p>
          )}
          {archived.length > 0 && (
            <div className="projects__archived">
              <Button
                size="small"
                aria-expanded={open}
                aria-controls={archivedId}
                onClick={() => setShowArchived(!open)}
              >
                보관된 프로젝트 {archived.length}건 {open ? '접기' : '보기'}
              </Button>
              <ul
                id={archivedId}
                hidden={!open}
                className="project-list"
                aria-label="보관된 프로젝트"
              >
                {archived.map((p) => (
                  <ProjectCard
                    key={p.id}
                    project={p}
                    current={false}
                    onAction={onAction}
                    people={people}
                    policy={policies.get(p.id)}
                  />
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </>
  )
}
