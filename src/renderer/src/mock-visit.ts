import type { VisitSummary } from '../../shared/visit'

/** 브라우저 개발 모드 전용 샘플 요약. 프로덕션 번들에서는 mock-api 자체가 제외된다. */
export function mockVisitSummary(): VisitSummary {
  const now = Date.now()
  return {
    since: new Date(now - 4 * 3600_000).toISOString(),
    until: new Date(now).toISOString(),
    firstVisit: false,
    reports: [
      { id: 'briefing-20261114090000', title: '틱 브리핑 2026-11-14 09:00 UTC', projectId: null }
    ],
    completedTickets: [{ id: 'T-040', title: '랜딩 페이지 문구 정리', projectId: 'my-company' }],
    newDecisions: [{ id: 'D-030', title: '푸시 컨펌 요청', projectId: null }],
    failedTicks: 1,
    audit: null,
    killSwitch: { company: false, projects: [], updatedAt: null }
  }
}
