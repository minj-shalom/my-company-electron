import type { ProjectInfo } from '../../../shared/project'
import { LIMITED_ACTIONS } from '../../../shared/policy'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Panel } from '../ui/Panel'
import {
  ACTION_LABELS,
  RESULT_LABELS,
  executedCounts,
  formatTime,
  isProjectPaused,
  summaryFor,
  totalEvents
} from './gate-model'
import type { AuditLoad } from './use-audit-summary'
import type { UseKillSwitch } from './use-kill-switch'

const SHOWN_FAILURES = 5

/**
 * 프로젝트 화면의 "자동 실행 기록". 오늘 감사 요약을 읽기 전용으로 보여 준다.
 * 일일 상한은 감사 요약에 없어서 건수만 보이고, 상한은 작업 흐름 설정에서 확인한다.
 */
export function AutoRunLog({
  projects,
  audit,
  onReload,
  ks
}: {
  projects: ProjectInfo[]
  audit: AuditLoad
  onReload: () => void
  ks: UseKillSwitch
}): React.JSX.Element {
  const state = ks.load.kind === 'ready' ? ks.load.state : null
  return (
    <section className="autorun" aria-labelledby="autorun-heading">
      <div className="projects__head">
        <h3 id="autorun-heading">자동 실행 기록 (오늘)</h3>
        <Button size="small" aria-disabled={audit.kind === 'loading'} onClick={onReload}>
          새로고침
        </Button>
      </div>
      {audit.kind === 'loading' && (
        <p className="hint" role="status">
          자동 실행 기록을 불러오고 있어요…
        </p>
      )}
      {audit.kind === 'error' && (
        <Panel>
          <p role="alert" className="error">
            {audit.message}
          </p>
          <Button onClick={onReload}>다시 시도</Button>
        </Panel>
      )}
      {audit.kind === 'ready' && projects.length === 0 && (
        <p className="empty-state">활성 프로젝트가 없어요</p>
      )}
      {audit.kind === 'ready' && projects.length > 0 && (
        <ul className="autorun__list" aria-label="프로젝트별 자동 실행 기록">
          {projects.map((p) => {
            const s = summaryFor(audit.summary, p.id)
            const counts = executedCounts(s)
            const paused = state ? isProjectPaused(state, p.id) : false
            const projectPaused = state?.projects.includes(p.id) ?? false
            return (
              <li key={p.id} className="autorun__item">
                <div className="autorun__head">
                  <strong>{p.name}</strong>
                  {paused && <Badge tone="bad">일시 중지됨</Badge>}
                  {state && !state.company && (
                    <Button
                      size="small"
                      aria-disabled={ks.busy}
                      aria-label={`${p.name} 자동 실행 ${projectPaused ? '재개' : '중지'}`}
                      onClick={() =>
                        !ks.busy &&
                        void ks.set({ scope: 'project', projectId: p.id, engaged: !projectPaused })
                      }
                    >
                      {projectPaused ? '재개' : '이 프로젝트만 중지'}
                    </Button>
                  )}
                </div>
                {totalEvents(s) === 0 ? (
                  <p className="hint">오늘 자동 실행 기록이 없어요</p>
                ) : (
                  <>
                    <p className="autorun__counts">
                      {LIMITED_ACTIONS.map((a) => `${ACTION_LABELS[a]} ${counts[a]}건`).join(' · ')}
                    </p>
                    {s && s.failures.length > 0 && (
                      <ul className="autorun__failures" aria-label={`${p.name} 실패·차단`}>
                        {s.failures.slice(0, SHOWN_FAILURES).map((f, i) => (
                          <li key={`${f.at}-${i}`}>
                            <time dateTime={f.at}>{formatTime(f.at)}</time>{' '}
                            {ACTION_LABELS[f.action]} <code>{f.target}</code>{' '}
                            {RESULT_LABELS[f.result]} ({f.employee}, {f.ticket})
                          </li>
                        ))}
                        {s.failures.length > SHOWN_FAILURES && (
                          <li className="hint">
                            외 {s.failures.length - SHOWN_FAILURES}건 더 있어요
                          </li>
                        )}
                      </ul>
                    )}
                  </>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <p className="hint">일일 상한은 각 프로젝트의 &ldquo;작업 흐름&rdquo;에서 확인해요.</p>
    </section>
  )
}
