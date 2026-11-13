import type { VisitSummary } from '../../../shared/visit'
import type { AuditProjectSummary } from '../../../shared/gate'
import { LIMITED_ACTIONS } from '../../../shared/policy'
import { ACTION_LABELS } from '../gate/gate-model'

export interface AutoGroup {
  projectId: string
  /** 예: "푸시 2건 · 병합 1건". 실행한 게 없으면 빈 문자열. */
  executed: string
  failures: AuditProjectSummary['failures']
}

/** 자동으로 한 일 구역. 실행도 실패도 없는 프로젝트는 뺀다. */
export function autoGroups(s: VisitSummary): AutoGroup[] {
  if (!s.audit) return []
  return s.audit.projects
    .map((p) => ({
      projectId: p.projectId,
      executed: LIMITED_ACTIONS.filter((a) => (p.counts[a]?.executed ?? 0) > 0)
        .map((a) => `${ACTION_LABELS[a]} ${p.counts[a].executed}건`)
        .join(' · '),
      failures: p.failures
    }))
    .filter((g) => g.executed !== '' || g.failures.length > 0)
}

export function pausedLabel(s: VisitSummary): string | null {
  const ks = s.killSwitch
  if (!ks) return null
  if (ks.company) return '자동 실행이 전체 중지 상태예요'
  if (ks.projects.length > 0) return `프로젝트 ${ks.projects.length}개의 자동 실행이 중지돼 있어요`
  return null
}

/** 보여 줄 소식이 하나라도 있는지. 첫 방문은 소식이 아니라 안내로 다룬다. */
export function hasNews(s: VisitSummary): boolean {
  return (
    s.reports.length > 0 ||
    s.completedTickets.length > 0 ||
    s.newDecisions.length > 0 ||
    s.failedTicks > 0 ||
    autoGroups(s).length > 0 ||
    pausedLabel(s) !== null
  )
}

export function sinceLabel(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} 이후`
}

/** aria-disabled는 클릭을 막지 못하므로, 처리 중에는 확인 요청을 여기서 버린다. */
export function runConfirmClick(busy: boolean, confirm: () => Promise<void>): void {
  if (!busy) void confirm()
}
