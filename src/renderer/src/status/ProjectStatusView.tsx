import type { ProjectStatusSummary } from '../../../shared/project-status'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { COLUMN_LABEL } from '../tickets/ticket-view'
import { isCurrent, scopeKey, scopeTitle, type StatusView } from './status-model'

const COLUMNS = ['backlog', 'in-progress', 'done'] as const

function Counts({
  counts
}: {
  counts: Record<(typeof COLUMNS)[number], number>
}): React.JSX.Element {
  return (
    <ul className="pstatus__counts" aria-label="칸별 티켓 수">
      {COLUMNS.map((c) => (
        <li key={c}>
          <span className="pstatus__num">{counts[c]}</span>
          <span className="pstatus__lbl">{COLUMN_LABEL[c]}</span>
        </li>
      ))}
    </ul>
  )
}

function decisionText(n: number, known: boolean): React.JSX.Element {
  if (!known) return <span className="hint">확인 불가</span>
  return n > 0 ? <Badge tone="warn">{`${n}건`}</Badge> : <span>없음</span>
}

function SummaryCard({
  s,
  current,
  decisionsKnown,
  onAssignPm,
  onViewTickets
}: {
  s: ProjectStatusSummary
  current: boolean
  decisionsKnown: boolean
  onAssignPm: () => void
  onViewTickets: (scope: string) => void
}): React.JSX.Element {
  const title = scopeTitle(s)
  const key = scopeKey(s)
  return (
    <li className="pstatus__card" data-current={current} data-pm={s.pmState ?? 'none'}>
      <div className="pstatus__head">
        <h3 className="pstatus__name">{title}</h3>
        {current && <Badge tone="info">보는 중</Badge>}
        {s.pmState === 'pm-required' && <Badge tone="warn">PM 필요</Badge>}
        {s.pmState === 'archived' && <Badge tone="neutral">보관됨</Badge>}
        {s.scope.kind === 'unknown' && <Badge tone="warn">등록되지 않음</Badge>}
      </div>
      <Counts counts={s.counts} />
      <dl className="pstatus__meta">
        <dt>막힌 결정</dt>
        <dd>{decisionText(s.pendingDecisions, decisionsKnown)}</dd>
        {s.scope.kind === 'project' && (
          <>
            <dt>담당 PM</dt>
            <dd>{s.pm ? s.pm.name : '없음'}</dd>
          </>
        )}
      </dl>
      {s.pmState === 'pm-required' && (
        <p className="notice pstatus__warn" role="note">
          PM이 없어 이 프로젝트의 티켓이 실행되지 않아요.{' '}
          <Button size="small" aria-label={`${title} PM 지정`} onClick={onAssignPm}>
            PM 지정
          </Button>
        </p>
      )}
      <div className="pstatus__recent">
        <h4>최근 완료</h4>
        {s.recentDone.length === 0 ? (
          <p className="hint">아직 완료한 티켓이 없어요.</p>
        ) : (
          <ul>
            {s.recentDone.map((t) => (
              <li key={t.id}>
                <span className="pstatus__id">{t.id}</span> {t.title}
              </li>
            ))}
          </ul>
        )}
      </div>
      {key !== null && (
        <Button size="small" aria-label={`${title} 티켓 보기`} onClick={() => onViewTickets(key)}>
          티켓 보기
        </Button>
      )}
    </li>
  )
}

/** 프로젝트별 진행 현황과 회사 전체 합계. 값은 모두 React 텍스트로 그린다. */
export function ProjectStatusView({
  view,
  current,
  onRetry,
  onAssignPm,
  onViewTickets
}: {
  view: StatusView
  /** 상단 "현재 프로젝트" 보기 범위 (null = 전체). */
  current: string | null
  onRetry: () => void
  onAssignPm: () => void
  onViewTickets: (scope: string) => void
}): React.JSX.Element {
  return (
    <section className="pstatus" aria-labelledby="status-heading">
      <div className="pstatus__top">
        <h2 id="status-heading">프로젝트 현황</h2>
      </div>
      {view.kind === 'loading' && (
        <p role="status" className="empty-state">
          현황을 불러오고 있어요…
        </p>
      )}
      {view.kind === 'error' && (
        <div className="empty-state">
          <p role="alert" className="error">
            {view.message}
          </p>
          <Button onClick={onRetry}>다시 시도</Button>
        </div>
      )}
      {view.kind === 'empty' && (
        <p className="empty-state">
          아직 프로젝트도 티켓도 없어요. 프로젝트 탭에서 프로젝트를 추가해 보세요.
        </p>
      )}
      {view.kind === 'ready' && (
        <>
          <section className="pstatus__total" aria-label="회사 전체 합계">
            <h3 className="pstatus__name">회사 전체</h3>
            <Counts counts={view.status.total.counts} />
            <dl className="pstatus__meta">
              <dt>막힌 결정</dt>
              <dd>{decisionText(view.status.total.pendingDecisions, view.decisionsKnown)}</dd>
              <dt>PM 필요 프로젝트</dt>
              <dd>
                {view.status.pmRequiredCount > 0 ? (
                  <>
                    <Badge tone="warn">{`${view.status.pmRequiredCount}개`}</Badge>{' '}
                    <Button size="small" onClick={onAssignPm}>
                      PM 지정
                    </Button>
                  </>
                ) : (
                  '없음'
                )}
              </dd>
            </dl>
          </section>
          <ul className="pstatus__list" aria-label="프로젝트별 현황">
            {view.status.summaries.map((s) => (
              <SummaryCard
                key={
                  s.scope.kind === 'company'
                    ? '@company'
                    : s.scope.kind === 'project'
                      ? `p:${s.scope.projectId}`
                      : `u:${s.scope.projectId}`
                }
                s={s}
                current={isCurrent(s, current)}
                decisionsKnown={view.decisionsKnown}
                onAssignPm={onAssignPm}
                onViewTickets={onViewTickets}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
