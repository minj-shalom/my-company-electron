import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ProjectInfo } from '../../../shared/project'
import { TICKET_STATUSES, type Ticket, type TicketStatus } from '../../../shared/ticket'
import { runExclusive } from '../lib/refresh'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { UnreadableNotice } from '../ui/UnreadableNotice'
import { TicketCard } from './TicketCard'
import { TicketFilters } from './TicketFilters'
import {
  applyProjectScope,
  needsPmNote,
  unassignedAssigneeWarn,
  projectBadge,
  projectOptions,
  type ProjectScope
} from './ticket-project'
import { TicketFormDialog, type TicketFormMode } from './TicketFormDialog'
import {
  applyFilters,
  canMove,
  COLUMN_LABEL,
  groupByStatus,
  moveErrorText,
  moveSuccessText,
  NO_FILTERS,
  shouldRefreshAfterMoveError,
  ticketUnreadableSummary,
  ticketUnreadableText,
  type TicketFilters as Filters
} from './ticket-view'
import type { UseTickets } from './use-tickets'

interface Notice {
  tone: 'ok' | 'warn'
  text: string
}

/** 티켓 보드. 상태(로딩/오류/빈/정상)를 나눠 그린다. */
export function TicketBoard({
  state,
  refresh,
  markMoved,
  onAssignPm,
  projects = null,
  scope = null,
  onScopeChange
}: UseTickets & {
  /** 폼의 "PM 지정" 링크가 프로젝트 화면으로 보낸다. */
  onAssignPm?: () => void
  /** 등록 프로젝트. 읽지 못했거나 아직 없으면 null이라 프로젝트 배지·칩을 숨긴다. */
  projects?: readonly ProjectInfo[] | null
  /** 상단 "현재 프로젝트"와 공유하는 보기 범위. */
  scope?: ProjectScope
  onScopeChange?: (scope: ProjectScope) => void
}): React.JSX.Element {
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [openId, setOpenId] = useState<string | null>(null)
  const [menuId, setMenuId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [form, setForm] = useState<TicketFormMode | null>(null)
  const lock = useRef(false)
  const root = useRef<HTMLElement>(null)
  const noticeRef = useRef<HTMLDivElement>(null)
  // 이동 직후 카드가 다른 열에 새로 그려지므로, 그려진 뒤 그 카드로 포커스를 돌려준다.
  const focusAfterMove = useRef<string | null>(null)

  const hired = useMemo(
    () => (state.kind === 'ready' && state.hired ? new Set(state.hired) : null),
    [state]
  )

  useEffect(() => {
    const id = focusAfterMove.current
    if (id === null) return
    focusAfterMove.current = null
    const target = [
      ...(root.current?.querySelectorAll<HTMLElement>('[data-ticket-focus]') ?? [])
    ].find((el) => el.dataset.ticketFocus === id)
    // 필터에 가려져 카드가 안 보이면 안내 문구로 포커스를 옮겨 위치를 잃지 않게 한다.
    ;(target ?? noticeRef.current)?.focus()
  }, [state])

  const move = async (t: Ticket, to: TicketStatus): Promise<string | null> => {
    if (!canMove(t.status, to)) return moveErrorText('invalid-request')
    const run = await runExclusive(lock, async () => {
      setBusyId(t.id)
      try {
        return await window.api.moveTicket({ id: t.id, to })
      } catch {
        return null
      } finally {
        setBusyId(null)
      }
    })
    if (!run.ran) return '다른 티켓을 옮기는 중이에요. 잠시 뒤 다시 시도해 주세요.'
    const r = run.value
    if (r === null) return moveErrorText('unknown')
    if (r.ok) {
      const status = TICKET_STATUSES.find((s) => s === r.value.status) ?? to
      focusAfterMove.current = t.id
      markMoved({ ...r.value, status })
      setMenuId(null)
      setNotice({ tone: 'ok', text: moveSuccessText(t.id, status) })
      return null
    }
    if (shouldRefreshAfterMoveError(r.code)) {
      focusAfterMove.current = null
      setMenuId(null)
      setNotice({ tone: 'warn', text: moveErrorText(r.code) })
      await refresh({ force: true })
      noticeRef.current?.focus()
      return null
    }
    return moveErrorText(r.code)
  }

  const saved = async (t: Ticket): Promise<void> => {
    const created = form?.kind === 'create'
    setForm(null)
    setNotice({ tone: 'ok', text: `${t.id} 티켓을 ${created ? '만들었어요' : '저장했어요'}.` })
    focusAfterMove.current = t.id
    await refresh({ force: true })
  }

  if (state.kind === 'loading') {
    return (
      <p role="status" className="empty-state">
        티켓을 불러오고 있어요…
      </p>
    )
  }
  if (state.kind === 'error') {
    return (
      <div className="empty-state">
        <p role="alert" className="error">
          {state.message}
        </p>
        <Button onClick={() => void refresh({ force: true })}>다시 시도</Button>
      </div>
    )
  }

  const scoped = applyProjectScope(state.items, scope)
  const visible = applyFilters(scoped, filters)
  const columns = groupByStatus(visible)
  return (
    <section className="tboard" aria-label="티켓 보드" ref={root}>
      {state.stale && (
        <p role="status" className="notice">
          최신 목록을 가져오지 못해 이전 목록을 보여 주고 있어요.{' '}
          <Button size="small" onClick={() => void refresh({ force: true })}>
            다시 시도
          </Button>
        </p>
      )}
      <div
        ref={noticeRef}
        tabIndex={-1}
        role="status"
        className={notice ? `notice dnotice dnotice--${notice.tone}` : undefined}
        hidden={!notice}
      >
        {notice && (
          <>
            {notice.text}{' '}
            <Button size="small" onClick={() => setNotice(null)}>
              닫기
            </Button>
          </>
        )}
      </div>
      <UnreadableNotice
        items={state.unreadable}
        summary={ticketUnreadableSummary}
        reasonText={ticketUnreadableText}
      />
      <div className="tboard__bar">
        <Button variant="primary" size="small" onClick={() => setForm({ kind: 'create' })}>
          새 티켓
        </Button>
      </div>
      {form && (
        <TicketFormDialog
          mode={form}
          onClose={() => setForm(null)}
          onSaved={(t) => void saved(t)}
          onAssignPm={
            onAssignPm
              ? () => {
                  setForm(null)
                  onAssignPm()
                }
              : undefined
          }
        />
      )}
      {state.items.length === 0 ? (
        <p className="empty-state">아직 티켓이 없어요.</p>
      ) : (
        <>
          <TicketFilters
            items={scoped}
            filters={filters}
            onChange={setFilters}
            project={
              projects && onScopeChange
                ? {
                    options: projectOptions(state.items, projects, scope),
                    value: scope,
                    onChange: onScopeChange
                  }
                : undefined
            }
          />
          <div className="tboard__cols">
            {TICKET_STATUSES.map((s) => (
              <Column
                key={s}
                status={s}
                items={columns[s]}
                filtered={visible.length === 0}
                hired={hired}
                projects={projects}
                openId={openId}
                setOpenId={setOpenId}
                menuId={menuId}
                setMenuId={setMenuId}
                busyId={busyId}
                onMove={move}
                onEdit={(t) => setForm({ kind: 'edit', ticket: t })}
              />
            ))}
          </div>
        </>
      )}
    </section>
  )
}

function Column({
  status,
  items,
  filtered,
  hired,
  projects,
  openId,
  setOpenId,
  menuId,
  setMenuId,
  busyId,
  onMove,
  onEdit
}: {
  status: TicketStatus
  items: Ticket[]
  /** 필터 때문에 모든 열이 비었다. */
  filtered: boolean
  hired: ReadonlySet<string> | null
  projects: readonly ProjectInfo[] | null
  openId: string | null
  setOpenId: (id: string | null) => void
  menuId: string | null
  setMenuId: (id: string | null) => void
  busyId: string | null
  onMove: (t: Ticket, to: TicketStatus) => Promise<string | null>
  onEdit: (t: Ticket) => void
}): React.JSX.Element {
  const headId = useId()
  return (
    <section className="tcol" aria-labelledby={headId}>
      <h3 id={headId} className="tcol__head">
        {COLUMN_LABEL[status]} <Badge>{items.length}</Badge>
      </h3>
      {items.length === 0 ? (
        <p className="hint tcol__empty">
          {filtered ? '필터에 맞는 티켓이 없어요.' : '이 열에 티켓이 없어요.'}
        </p>
      ) : (
        <ul className="tlist" aria-label={`${COLUMN_LABEL[status]} 티켓`}>
          {items.map((t) => (
            <TicketCard
              key={t.id}
              ticket={t}
              hired={hired}
              project={projectBadge(t, projects)}
              pmNote={needsPmNote(t, projects)}
              unassignedWarn={unassignedAssigneeWarn(t, projects)}
              expanded={openId === t.id}
              onToggle={() => setOpenId(openId === t.id ? null : t.id)}
              menuOpen={menuId === t.id}
              onMenuChange={(open) => setMenuId(open ? t.id : null)}
              busy={busyId === t.id}
              locked={busyId !== null}
              onMove={onMove}
              onEdit={onEdit}
            />
          ))}
        </ul>
      )}
    </section>
  )
}
