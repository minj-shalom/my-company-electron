import {
  AUDIT_RESULTS,
  type AuditProjectSummary,
  type AuditResult,
  type AuditSummary,
  type KillSwitchState
} from '../../../shared/gate'
import { LIMITED_ACTIONS, type LimitedAction } from '../../../shared/policy'
import type { BadgeTone } from '../ui/Badge'

export const ACTION_LABELS: Record<LimitedAction, string> = {
  push: '푸시',
  merge: '병합',
  publish: '발행'
}

export const RESULT_LABELS: Record<AuditResult, string> = {
  executed: '실행함',
  failed: '실패',
  'blocked-limit': '일일 상한으로 막힘',
  'blocked-killswitch': '일시 중지로 막힘',
  'blocked-target': '허용 대상이 아니라 막힘',
  'blocked-review': '검수 전이라 막힘',
  'fallback-card': '결재 카드로 넘김',
  duplicate: '중복이라 건너뜀'
}

export interface KillSwitchView {
  paused: boolean
  /** 배지에 보일 문구. 자동 모드 프로젝트가 없고 중지도 아니면 null. */
  badge: { tone: BadgeTone; label: string } | null
  buttonLabel: string
}

/** 킬 스위치 상태와 자동 모드 프로젝트 수로 상태바 표시를 정한다. */
export function killSwitchView(state: KillSwitchState, autoProjectCount: number): KillSwitchView {
  if (state.company) {
    return {
      paused: true,
      badge: { tone: 'bad', label: '일시 중지됨 (전체)' },
      buttonLabel: '자동 실행 재개'
    }
  }
  const n = state.projects.length
  if (n > 0) {
    return {
      paused: false,
      badge: { tone: 'warn', label: `일시 중지됨 (프로젝트 ${n}개)` },
      buttonLabel: '자동 실행 모두 중지'
    }
  }
  return {
    paused: false,
    badge:
      autoProjectCount > 0
        ? { tone: 'info', label: `자동 모드 중 (프로젝트 ${autoProjectCount}개)` }
        : null,
    buttonLabel: '자동 실행 모두 중지'
  }
}

export function isProjectPaused(state: KillSwitchState, projectId: string): boolean {
  return state.company || state.projects.includes(projectId)
}

/** 사용자 로컬 시간 기준 오늘 [00:00, 내일 00:00). */
export function todayRange(now: Date): { from: string; to: string } {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  return { from: start.toISOString(), to: end.toISOString() }
}

/** 동작별로 오늘 실제로 실행한 건수. */
export function executedCounts(p: AuditProjectSummary | undefined): Record<LimitedAction, number> {
  return {
    push: p?.counts.push?.executed ?? 0,
    merge: p?.counts.merge?.executed ?? 0,
    publish: p?.counts.publish?.executed ?? 0
  }
}

export function totalEvents(p: AuditProjectSummary | undefined): number {
  if (!p) return 0
  return LIMITED_ACTIONS.reduce(
    (sum, a) => sum + AUDIT_RESULTS.reduce((s, r) => s + (p.counts[a]?.[r] ?? 0), 0),
    0
  )
}

export function summaryFor(s: AuditSummary, projectId: string): AuditProjectSummary | undefined {
  return s.projects.find((p) => p.projectId === projectId)
}

export function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '-'
  const h = String(d.getHours()).padStart(2, '0')
  const m = String(d.getMinutes()).padStart(2, '0')
  return `${h}:${m}`
}
