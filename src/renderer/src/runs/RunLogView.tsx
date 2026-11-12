import { useEffect, useId, useRef, useState } from 'react'
import { runExclusive } from '../lib/refresh'
import { Badge, type BadgeTone } from '../ui/Badge'
import { Button } from '../ui/Button'
import {
  isActive,
  KIND_LABEL,
  runLabel,
  scrolledAwayFromBottom,
  STATUS_LABEL,
  usageText,
  windowEntries,
  type RunLog,
  type RunStatus
} from './run-log-model'
import type { UseRunLog } from './use-run-log'

const STATUS_TONE: Record<RunStatus, BadgeTone> = {
  pending: 'neutral',
  running: 'info',
  done: 'good',
  error: 'bad',
  cancelled: 'warn'
}

/** 직원 로그 탭. 실행(run)마다 묶어 이벤트를 종류별로 보여 준다. */
export function RunLogView({ view, retry, more }: UseRunLog): React.JSX.Element {
  const [autoScroll, setAutoScroll] = useState(true)
  const [autoOffNotice, setAutoOffNotice] = useState(false)
  const toggleId = useId()

  if (view.kind === 'connecting') {
    return (
      <p role="status" className="empty-state">
        실행 로그를 연결하고 있어요…
      </p>
    )
  }
  if (view.kind === 'error') {
    return (
      <div className="empty-state">
        <p role="alert" className="error">
          실행 로그를 받을 수 없어요.
        </p>
        <Button onClick={retry}>다시 시도</Button>
      </div>
    )
  }
  const { log } = view
  if (log.order.length === 0) return <p className="empty-state">아직 일하는 직원이 없어요.</p>

  return (
    <section className="rlog" aria-label="실행 로그">
      <div className="rlog__bar">
        <label htmlFor={toggleId} className="rlog__toggle">
          <input
            id={toggleId}
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => {
              setAutoScroll(e.target.checked)
              setAutoOffNotice(false)
            }}
          />
          자동 스크롤
        </label>
        {autoOffNotice && (
          <p role="status" className="rlog__hint">
            위로 스크롤해서 자동 스크롤을 껐어요. 다시 켜면 맨 아래를 따라가요.
          </p>
        )}
      </div>
      {[...log.order].reverse().map((id) => {
        const run = log.runs[id]
        return run ? (
          <RunGroup
            key={id}
            run={run}
            label={runLabel(log.order, id)}
            autoScroll={autoScroll}
            onUserScrolledUp={() => {
              if (autoScroll) {
                setAutoScroll(false)
                setAutoOffNotice(true)
              }
            }}
            more={more}
          />
        ) : null
      })}
    </section>
  )
}

function RunGroup({
  run,
  label,
  autoScroll,
  onUserScrolledUp,
  more
}: {
  run: RunLog
  label: string
  autoScroll: boolean
  onUserScrolledUp: () => void
  more: (runId: string) => void
}): React.JSX.Element {
  const headId = useId()
  const scroller = useRef<HTMLDivElement>(null)
  const lock = useRef(false)
  const mounted = useRef(true)
  const [cancelNote, setCancelNote] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const { shown, hidden } = windowEntries(run)
  const usage = usageText(run.usage)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    const el = scroller.current
    if (autoScroll && el) el.scrollTop = el.scrollHeight
  }, [autoScroll, run.entries])

  const cancel = async (): Promise<void> => {
    const r = await runExclusive(lock, async () => {
      setCancelling(true)
      try {
        return await window.api.cancelRun(run.runId)
      } catch {
        return null
      } finally {
        if (mounted.current) setCancelling(false)
      }
    })
    if (!mounted.current) return
    if (!r.ran) return
    if (r.value === null) setCancelNote('취소하지 못했어요. 잠시 뒤 다시 시도해 주세요.')
    else if (!r.value) setCancelNote('이미 끝났거나 찾을 수 없는 실행이에요.')
    else setCancelNote(null)
  }

  return (
    <article className="rrun" aria-labelledby={headId} data-status={run.status}>
      <header className="rrun__head">
        <h3 id={headId} className="rrun__title">
          {label}
        </h3>
        <Badge tone={STATUS_TONE[run.status]}>{STATUS_LABEL[run.status]}</Badge>
        {usage && <span className="rrun__usage">{usage}</span>}
        <Button
          size="small"
          disabled={!isActive(run.status) || cancelling}
          onClick={() => void cancel()}
        >
          {cancelling ? '취소하는 중…' : '실행 취소'}
        </Button>
      </header>
      {cancelNote && (
        <p role="status" className="notice">
          {cancelNote}
        </p>
      )}
      {/* role=log는 암묵적으로 live 영역이라 토큰 단위로 낭독되지 않게 끄고, 상태 변화만 아래 sr-only 영역으로 알린다. */}
      <span role="status" className="sr-only">
        {label} {STATUS_LABEL[run.status]}
      </span>
      <div
        ref={scroller}
        className="rrun__scroll"
        role="log"
        aria-live="off"
        aria-label={`${label} 이벤트`}
        tabIndex={0}
        onScroll={(e) => {
          const t = e.currentTarget
          if (scrolledAwayFromBottom(t)) onUserScrolledUp()
        }}
      >
        {(hidden > 0 || run.dropped > 0) && (
          <div className="rrun__earlier">
            {run.dropped > 0 && (
              <p className="rrun__dropped">
                오래된 이벤트 {run.dropped}건은 보관 한도를 넘어 지웠어요.
              </p>
            )}
            {hidden > 0 && (
              <Button size="small" onClick={() => more(run.runId)}>
                이전 {Math.min(hidden, 200)}건 더 보기 (숨김 {hidden}건)
              </Button>
            )}
          </div>
        )}
        {shown.length === 0 ? (
          <p className="rrun__wait">이벤트를 기다리고 있어요…</p>
        ) : (
          <ol className="rrun__list">
            {shown.map((e) => (
              <li key={e.seq} className="rev" data-kind={e.kind} data-failed={e.failed}>
                <span className="rev__tag">
                  <Badge tone={e.failed ? 'bad' : 'neutral'}>{KIND_LABEL[e.kind]}</Badge>
                  <span className="rev__title">{e.title}</span>
                </span>
                <pre className="rev__text">{e.text}</pre>
                {e.truncated && <p className="rev__cut">본문이 너무 길어 뒷부분을 잘랐어요.</p>}
              </li>
            ))}
          </ol>
        )}
      </div>
    </article>
  )
}
