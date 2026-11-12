import { useEffect, useId, useRef, useState } from 'react'
import type { Decision, DecisionResolveRequest } from '../../../shared/decision'
import { DECISION_KINDS } from '../../../shared/decision'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Tabs } from '../ui/Tabs'
import { DecisionCard } from './DecisionCard'
import {
  countByKind,
  filterByKind,
  filterUnreadable,
  KIND_META,
  resolveErrorText,
  shouldRefreshAfterError,
  splitDecisions,
  unreadableReasonText,
  unreadableSummary,
  type KindFilter
} from './decision-view'
import type { UseDecisions } from './use-decisions'

type InboxTab = 'pending' | 'done'

interface Notice {
  tone: 'ok' | 'warn'
  text: string
}

/** 결재함. 상태(로딩/오류/빈/정상)를 나눠 그린다. */
export function DecisionInbox({ state, refresh, markResolved }: UseDecisions): React.JSX.Element {
  const [tab, setTab] = useState<InboxTab>('pending')
  const [filter, setFilter] = useState<KindFilter>('all')
  const [openId, setOpenId] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)

  const resolve = async (req: DecisionResolveRequest): Promise<string | null> => {
    try {
      const r = await window.api.resolveDecision(req)
      if (r.ok) {
        markResolved(r.value)
        setOpenId(null)
        setNotice({
          tone: 'ok',
          text: `${req.id} 결정을 기록했어요. '처리됨' 탭으로 옮겼어요.`
        })
        return null
      }
      const text = resolveErrorText(r.code)
      if (shouldRefreshAfterError(r.code)) {
        setNotice({ tone: 'warn', text })
        await refresh({ force: true })
      }
      return text
    } catch {
      return resolveErrorText('unknown')
    }
  }

  return (
    <section className="inbox" aria-label="결재함">
      {/* T-053이 자동 모드 상태 배지와 킬 스위치를 채울 자리. 지금은 비워 둔다. */}
      <div className="inbox__slot" data-slot="auto-mode" />
      <InboxBody
        state={state}
        tab={tab}
        setTab={setTab}
        filter={filter}
        setFilter={setFilter}
        openId={openId}
        setOpenId={setOpenId}
        notice={notice}
        dismissNotice={() => setNotice(null)}
        refresh={refresh}
        resolve={resolve}
      />
    </section>
  )
}

interface BodyProps {
  state: UseDecisions['state']
  tab: InboxTab
  setTab: (t: InboxTab) => void
  filter: KindFilter
  setFilter: (f: KindFilter) => void
  openId: string | null
  setOpenId: (id: string | null) => void
  notice: Notice | null
  dismissNotice: () => void
  refresh: UseDecisions['refresh']
  resolve: (req: DecisionResolveRequest) => Promise<string | null>
}

function InboxBody(p: BodyProps): React.JSX.Element {
  const { state } = p
  if (state.kind === 'loading') {
    return (
      <p role="status" className="empty-state">
        결재함을 불러오고 있어요…
      </p>
    )
  }
  if (state.kind === 'error') {
    return (
      <div className="empty-state">
        <p role="alert" className="error">
          {state.message}
        </p>
        <Button onClick={() => void p.refresh()}>다시 시도</Button>
      </div>
    )
  }
  const { pending, done } = splitDecisions(state.items)
  const tabs = [
    {
      id: 'pending',
      label: '대기 중',
      extra: <Badge tone={pending.length > 0 ? 'warn' : 'neutral'}>{pending.length}</Badge>
    },
    { id: 'done', label: '처리됨', extra: <Badge>{done.length}</Badge> }
  ]
  const list = p.tab === 'pending' ? pending : done
  return (
    <>
      {state.stale && (
        <p role="status" className="notice">
          최신 목록을 가져오지 못해 이전 목록을 보여 주고 있어요.{' '}
          <Button size="small" onClick={() => void p.refresh()}>
            다시 시도
          </Button>
        </p>
      )}
      {p.notice && <NoticeBar notice={p.notice} onDismiss={p.dismissNotice} />}
      <Tabs
        label="결재 상태"
        tabs={tabs}
        selectedId={p.tab}
        onSelect={(id) => {
          p.setTab(id === 'done' ? 'done' : 'pending')
          p.setOpenId(null)
        }}
      >
        <Unreadable items={filterUnreadable(state.unreadable, p.tab)} />
        <KindFilters items={list} filter={p.filter} setFilter={p.setFilter} />
        <CardList
          items={filterByKind(list, p.filter)}
          total={list.length}
          tab={p.tab}
          openId={p.openId}
          setOpenId={p.setOpenId}
          resolve={p.resolve}
        />
      </Tabs>
    </>
  )
}

/** 처리 결과 안내. 카드가 사라져 포커스를 잃으므로 나타날 때 포커스를 옮긴다. */
function NoticeBar({
  notice,
  onDismiss
}: {
  notice: Notice
  onDismiss: () => void
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.focus()
  }, [notice])
  return (
    <div ref={ref} tabIndex={-1} role="status" className={`notice dnotice dnotice--${notice.tone}`}>
      {notice.text}{' '}
      <Button size="small" onClick={onDismiss}>
        닫기
      </Button>
    </div>
  )
}

function Unreadable({
  items
}: {
  items: ReturnType<typeof filterUnreadable>
}): React.JSX.Element | null {
  const listId = useId()
  const [open, setOpen] = useState(false)
  if (items.length === 0) return null
  return (
    <div className="notice dunread" role="status">
      <div className="dunread__head">
        <strong>{unreadableSummary(items.length)}</strong>
        <Button
          size="small"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? '접기' : '목록 보기'}
        </Button>
      </div>
      <ul id={listId} hidden={!open} className="dunread__list">
        {items.map((u) => (
          <li key={`${u.path}:${u.reason}`}>
            <code>{u.path}</code> - {unreadableReasonText(u.reason)}
          </li>
        ))}
      </ul>
    </div>
  )
}

function KindFilters({
  items,
  filter,
  setFilter
}: {
  items: Decision[]
  filter: KindFilter
  setFilter: (f: KindFilter) => void
}): React.JSX.Element | null {
  if (items.length === 0) return null
  const counts = countByKind(items)
  const chips: { id: KindFilter; label: string; count: number }[] = [
    { id: 'all', label: '전체', count: items.length },
    ...DECISION_KINDS.filter((k) => counts[k] > 0 || filter === k).map((k) => ({
      id: k,
      label: KIND_META[k].label,
      count: counts[k]
    }))
  ]
  return (
    <div className="dfilters" role="group" aria-label="유형 필터">
      {chips.map((c) => (
        <button
          key={c.id}
          type="button"
          className="dchip"
          aria-pressed={filter === c.id}
          onClick={() => setFilter(c.id)}
        >
          {c.label} {c.count}
        </button>
      ))}
    </div>
  )
}

function CardList({
  items,
  total,
  tab,
  openId,
  setOpenId,
  resolve
}: {
  items: Decision[]
  total: number
  tab: InboxTab
  openId: string | null
  setOpenId: (id: string | null) => void
  resolve: BodyProps['resolve']
}): React.JSX.Element {
  if (total === 0) {
    return (
      <p className="empty-state">
        {tab === 'pending' ? '결재를 기다리는 일이 없어요.' : '처리한 결재가 아직 없어요.'}
      </p>
    )
  }
  if (items.length === 0) {
    return <p className="empty-state">이 유형의 카드가 없어요. 필터를 바꿔 보세요.</p>
  }
  return (
    <ul className="dlist" aria-label={tab === 'pending' ? '대기 중인 결재' : '처리된 결재'}>
      {items.map((d) => (
        <DecisionCard
          key={d.id}
          decision={d}
          expanded={openId === d.id}
          onToggle={() => setOpenId(openId === d.id ? null : d.id)}
          onResolve={resolve}
        />
      ))}
    </ul>
  )
}
