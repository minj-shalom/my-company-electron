import { useEffect, useId, useRef, useState } from 'react'
import type { Ticket, TicketStatus } from '../../../shared/ticket'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import {
  ASSIGNEE_BADGE_TEXT,
  ASSIGNEE_BADGE_TONE,
  assigneeBadge,
  assigneeOf,
  canMove,
  COLUMN_LABEL,
  departmentOf,
  moveTargets,
  TRUNCATED_NOTE
} from './ticket-view'

interface Props {
  ticket: Ticket
  /** 조직도의 직원 id. 조직도를 읽지 못했으면 null. */
  hired: ReadonlySet<string> | null
  expanded: boolean
  onToggle: () => void
  menuOpen: boolean
  onMenuChange: (open: boolean) => void
  /** 이 카드를 처리 중. */
  busy: boolean
  /** 다른 이동이 진행 중이면 새 이동을 시작하지 않게 막는다. */
  locked: boolean
  /** 실패하면 사용자용 문구를 돌려준다. 성공하면 null. */
  onMove: (ticket: Ticket, to: TicketStatus) => Promise<string | null>
}

/** 티켓 카드. 제목, 담당, 본문은 모두 React 텍스트 노드로만 그린다 (HTML·마크다운 렌더 없음). */
export function TicketCard({
  ticket: t,
  hired,
  expanded,
  onToggle,
  menuOpen,
  onMenuChange,
  busy,
  locked,
  onMove
}: Props): React.JSX.Element {
  const bodyId = useId()
  const menuId = useId()
  const selectId = useId()
  const targets = moveTargets(t.status)
  const [to, setTo] = useState<TicketStatus>(targets[0])
  const [error, setError] = useState<string | null>(null)
  const moveBtn = useRef<HTMLButtonElement>(null)
  const select = useRef<HTMLSelectElement>(null)
  const assignee = assigneeOf(t)
  const badge = assigneeBadge(t, hired)
  const dept = departmentOf(t)

  // 메뉴가 열리면 키보드 사용자가 바로 고를 수 있게 select로 포커스를 옮긴다.
  useEffect(() => {
    if (menuOpen) select.current?.focus()
  }, [menuOpen])

  const close = (): void => {
    setError(null)
    onMenuChange(false)
    moveBtn.current?.focus()
  }

  const confirm = async (): Promise<void> => {
    if (!canMove(t.status, to)) return
    setError(null)
    const err = await onMove(t, to)
    // 성공하면 카드가 다른 열로 옮겨져 이 인스턴스는 사라진다. 실패 문구만 남긴다.
    if (err) setError(err)
  }

  return (
    <li className="tcard" data-status={t.status} aria-busy={busy}>
      <div className="tcard__top">
        <span className="tcard__id">{t.id}</span>
        {dept && <span className="tcard__dept">{dept}</span>}
      </div>
      <button
        type="button"
        className="tcard__title"
        data-ticket-focus={t.id}
        aria-expanded={expanded}
        aria-controls={bodyId}
        onClick={onToggle}
      >
        {t.title}
      </button>
      <div className="tcard__meta">
        {assignee !== null && <span className="tcard__assignee">담당 {assignee}</span>}
        {badge && <Badge tone={ASSIGNEE_BADGE_TONE[badge]}>{ASSIGNEE_BADGE_TEXT[badge]}</Badge>}
      </div>
      <div id={bodyId} className="tcard__body" hidden={!expanded}>
        {expanded && (
          <>
            {t.bodyTruncated === true && <p className="hint">{TRUNCATED_NOTE}</p>}
            <p className="tcard__text">{t.body.trim() === '' ? '본문이 없어요.' : t.body}</p>
          </>
        )}
      </div>
      <div className="tcard__actions">
        <Button
          size="small"
          ref={moveBtn}
          aria-expanded={menuOpen}
          aria-controls={menuId}
          disabled={locked && !busy}
          onClick={() => {
            setError(null)
            setTo(targets[0])
            onMenuChange(!menuOpen)
          }}
        >
          이동
        </Button>
      </div>
      <div id={menuId} className="tcard__menu" hidden={!menuOpen}>
        {menuOpen && (
          <>
            <label htmlFor={selectId} className="tcard__label">
              옮길 열
            </label>
            <select
              id={selectId}
              ref={select}
              className="input tcard__select"
              value={to}
              disabled={busy}
              onChange={(e) => {
                const next = targets.find((s) => s === e.target.value)
                if (next) setTo(next)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') close()
              }}
            >
              {targets.map((s) => (
                <option key={s} value={s}>
                  {COLUMN_LABEL[s]}
                </option>
              ))}
            </select>
            <div className="tcard__menu-actions">
              <Button
                size="small"
                variant="primary"
                disabled={busy || locked}
                onClick={() => void confirm()}
              >
                {busy ? '옮기는 중…' : '옮기기'}
              </Button>
              <Button size="small" disabled={busy} onClick={close}>
                취소
              </Button>
            </div>
            {error && (
              <p role="alert" className="error tcard__error">
                {error}
              </p>
            )}
          </>
        )}
      </div>
    </li>
  )
}
