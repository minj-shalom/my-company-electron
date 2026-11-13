import type { ProjectInfo } from '../../../shared/project'
import type { Ticket } from '../../../shared/ticket'
import type { BadgeTone } from '../ui/Badge'
import type { FilterOption, FilterValue } from './ticket-view'

/** 보기 범위: null = 회사 전체, '' = 회사 공통(소속 없음), 그 밖 = 프로젝트 id. 소유를 바꾸지 않는 보기 필터다. */
export type ProjectScope = FilterValue
export const COMPANY_COMMON_LABEL = '회사 공통'
export const UNKNOWN_PROJECT_LABEL = '미확인 프로젝트'
export const PM_PENDING_NOTE = 'PM 지정 전까지 실행되지 않음'

export const projectKeyOf = (t: Pick<Ticket, 'projectId'>): string =>
  typeof t.projectId === 'string' ? t.projectId : ''

export function applyProjectScope(items: readonly Ticket[], scope: ProjectScope): Ticket[] {
  return scope === null ? [...items] : items.filter((t) => projectKeyOf(t) === scope)
}

export interface ProjectBadgeView {
  label: string
  tone: BadgeTone
}

/**
 * 카드의 프로젝트 배지. 목록을 읽지 못했으면(null) 등록 여부를 알 수 없어 "미확인"으로 오해시키지 않도록 배지를 숨긴다.
 * 등록되지 않았거나 보관된 프로젝트는 오류가 아니라 "미확인 프로젝트"다.
 */
export function projectBadge(
  t: Pick<Ticket, 'projectId'>,
  projects: readonly ProjectInfo[] | null
): ProjectBadgeView | null {
  if (projects === null) return null
  const key = projectKeyOf(t)
  if (key === '') return { label: COMPANY_COMMON_LABEL, tone: 'neutral' }
  const p = projects.find((x) => x.id === key)
  if (!p || p.status === 'archived') {
    return { label: p ? `${p.name} (보관됨)` : UNKNOWN_PROJECT_LABEL, tone: 'warn' }
  }
  return { label: p.name, tone: 'info' }
}

/** PM이 필요한 프로젝트의 대기 티켓에만 붙는 안내 여부. */
export function needsPmNote(
  t: Pick<Ticket, 'projectId' | 'status'>,
  projects: readonly ProjectInfo[] | null
): boolean {
  if (projects === null || t.status !== 'backlog') return false
  return projects.some((p) => p.id === projectKeyOf(t) && p.state === 'pm-required')
}

/** 프로젝트 칩: 전체, 활성 프로젝트(등록 순), 회사 공통. 개수는 전체 티켓 기준이다. */
export function projectOptions(
  items: readonly Ticket[],
  projects: readonly ProjectInfo[],
  scope: ProjectScope
): FilterOption[] {
  const count = (key: string): number => items.filter((t) => projectKeyOf(t) === key).length
  const out: FilterOption[] = [{ key: null, label: '전체', count: items.length }]
  for (const p of projects)
    if (p.status === 'active') out.push({ key: p.id, label: p.name, count: count(p.id) })
  const common = count('')
  if (common > 0 || scope === '') out.push({ key: '', label: COMPANY_COMMON_LABEL, count: common })
  return out
}
