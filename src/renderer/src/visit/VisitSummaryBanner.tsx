import { useEffect, useRef } from 'react'
import type { VisitItem } from '../../../shared/visit'
import { ACTION_LABELS, RESULT_LABELS, formatTime } from '../gate/gate-model'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { autoGroups, hasNews, pausedLabel, sinceLabel } from './visit-model'
import type { UseVisitSummary } from './use-visit-summary'

function Items({ title, items }: { title: string; items: VisitItem[] }): React.JSX.Element | null {
  if (items.length === 0) return null
  return (
    <section className="visit__block" aria-label={title}>
      <h3>
        {title} <Badge tone="info">{items.length}</Badge>
      </h3>
      <ul className="visit__list">
        {items.map((i) => (
          <li key={i.id}>
            <span className="visit__id">{i.id}</span> <span>{i.title}</span>
            {i.projectId && <Badge>{i.projectId}</Badge>}
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * 앱 시작 방문 요약 배너. 상태: 로딩, 오류(다시 시도), 첫 방문 안내, 새 소식 없음, 요약.
 * 확인 버튼을 눌러야 마지막 방문 시각이 갱신되고 배너가 닫힌다.
 */
export function VisitSummaryBanner({
  visit,
  onOpenDecisions
}: {
  visit: UseVisitSummary
  onOpenDecisions: () => void
}): React.JSX.Element | null {
  const { load, busy, confirmError } = visit
  const headingRef = useRef<HTMLHeadingElement>(null)
  const ready = load.kind === 'ready'
  // 요약이 처음 그려질 때 제목으로 포커스를 옮겨 스크린리더·키보드 사용자가 바로 읽게 한다.
  useEffect(() => {
    if (ready) headingRef.current?.focus()
  }, [ready])

  if (load.kind === 'dismissed') return null
  if (load.kind === 'loading')
    return (
      <div className="visit hint" role="status" aria-live="polite">
        새 소식을 불러오고 있어요…
      </div>
    )
  if (load.kind === 'error')
    return (
      <section className="visit" aria-label="새 소식">
        <p role="alert" className="error">
          {load.message}
        </p>
        <Button size="small" onClick={visit.reload}>
          다시 시도
        </Button>
      </section>
    )

  const s = load.summary
  const confirmBtn = (
    <Button
      size="small"
      variant="primary"
      onClick={() => void visit.confirm()}
      aria-disabled={busy}
    >
      {busy ? '확인 중…' : '확인했어요'}
    </Button>
  )
  const err = confirmError && (
    <p role="alert" className="error">
      {confirmError}
    </p>
  )

  if (s.firstVisit || !hasNews(s)) {
    return (
      <section className="visit" aria-labelledby="visit-heading">
        <h2 id="visit-heading" tabIndex={-1} ref={headingRef}>
          {s.firstVisit ? '처음 오셨네요' : '새 소식이 없어요'}
        </h2>
        <p className="hint">
          {s.firstVisit
            ? '다음에 오시면 그동안 끝난 일과 결재할 일을 여기서 알려 드릴게요.'
            : `${sinceLabel(s.since)} 달라진 게 없어요.`}
        </p>
        <div className="toolbar">{confirmBtn}</div>
        {err}
      </section>
    )
  }

  const groups = autoGroups(s)
  const paused = pausedLabel(s)
  const hasFailure = s.failedTicks > 0 || groups.some((g) => g.failures.length > 0)
  return (
    <section className="visit" aria-labelledby="visit-heading">
      <div className="visit__head">
        <h2 id="visit-heading" tabIndex={-1} ref={headingRef}>
          새 소식 <span className="hint">{sinceLabel(s.since)}</span>
        </h2>
        {s.newDecisions.length > 0 && (
          <Button size="small" onClick={onOpenDecisions}>
            결재함 보기
          </Button>
        )}
        {confirmBtn}
      </div>
      {err}
      <div className="visit__grid">
        <Items title="끝난 티켓" items={s.completedTickets} />
        <Items title="새 결재 요청" items={s.newDecisions} />
        {s.reports.length > 0 && (
          <section className="visit__block" aria-label="최신 브리핑">
            <h3>
              최신 브리핑 <Badge tone="info">{s.reports.length}</Badge>
            </h3>
            <p className="hint">{s.reports[0].title}</p>
            <p className="hint">
              회사 폴더의 reports 폴더에 저장돼 있어요. 아직 앱에서 열 수는 없어요.
            </p>
          </section>
        )}
      </div>
      {hasFailure && (
        <div role="alert" className="visit__alert">
          {s.failedTicks > 0 && <p>실패하거나 시간이 지나 끝난 작업이 {s.failedTicks}건 있어요.</p>}
        </div>
      )}
      {(groups.length > 0 || paused) && (
        <section className="visit__block" aria-label="자동으로 한 일">
          <h3>자동으로 한 일</h3>
          {paused && <p className="hint">{paused}</p>}
          <ul className="visit__list">
            {groups.map((g) => (
              <li key={g.projectId}>
                <details open={g.failures.length > 0}>
                  <summary>
                    {g.projectId} <span className="hint">{g.executed || '실행한 일 없음'}</span>
                  </summary>
                  {g.failures.length > 0 && (
                    <ul className="visit__list" role="alert">
                      {g.failures.map((f, i) => (
                        <li key={`${f.at}-${i}`} className="error">
                          {formatTime(f.at)} {ACTION_LABELS[f.action]} {RESULT_LABELS[f.result]}
                        </li>
                      ))}
                    </ul>
                  )}
                </details>
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  )
}
