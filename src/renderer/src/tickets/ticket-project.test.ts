import { describe, expect, it } from 'vitest'
import type { ProjectInfo } from '../../../shared/project'
import type { Ticket } from '../../../shared/ticket'
import { applyProjectScope, needsPmNote, projectBadge, projectOptions } from './ticket-project'

const proj = (id: string, over: Partial<ProjectInfo> = {}): ProjectInfo => ({
  id,
  name: `이름 ${id}`,
  path: `/x/${id}`,
  type: 'development',
  devCommand: null,
  defaultBranch: null,
  status: 'active',
  pmId: 'pm',
  pm: null,
  state: 'ready',
  git: { status: 'ok', branch: 'develop', dirty: false },
  ...over
})
const t = (
  id: string,
  projectId?: string | null,
  status: Ticket['status'] = 'backlog'
): Ticket => ({
  id,
  title: id,
  status,
  assignee: null,
  department: null,
  body: '',
  ...(projectId === undefined ? {} : { projectId })
})
const projects = [
  proj('a'),
  proj('b', { state: 'pm-required', pmId: null }),
  proj('old', { status: 'archived', state: 'archived' })
]

describe('ticket project helpers', () => {
  it('filters by scope without changing ownership', () => {
    const items = [t('T-001', 'a'), t('T-002', null), t('T-003'), t('T-004', 'zzz')]
    expect(applyProjectScope(items, null)).toHaveLength(4)
    expect(applyProjectScope(items, '').map((x) => x.id)).toEqual(['T-002', 'T-003'])
    expect(applyProjectScope(items, 'a').map((x) => x.id)).toEqual(['T-001'])
    expect(applyProjectScope(items, 'zzz')).toHaveLength(1)
  })
  it('builds badges: registered, common, archived and unknown are not errors', () => {
    expect(projectBadge(t('T-1', 'a'), projects)).toEqual({ label: '이름 a', tone: 'info' })
    expect(projectBadge(t('T-1'), projects)?.label).toBe('회사 공통')
    expect(projectBadge(t('T-1', 'old'), projects)?.label).toBe('이름 old (보관됨)')
    expect(projectBadge(t('T-1', 'nope'), projects)?.label).toBe('미확인 프로젝트')
    expect(projectBadge(t('T-1', 'nope'), null)).toBeNull()
  })
  it('notes PM-required only on backlog tickets of such projects', () => {
    expect(needsPmNote(t('T-1', 'b'), projects)).toBe(true)
    expect(needsPmNote(t('T-1', 'b', 'done'), projects)).toBe(false)
    expect(needsPmNote(t('T-1', 'a'), projects)).toBe(false)
    expect(needsPmNote(t('T-1', 'b'), null)).toBe(false)
  })
  it('lists all, active projects and company-common chips with counts', () => {
    const items = [t('T-1', 'a'), t('T-2', 'a'), t('T-3'), t('T-4', 'old')]
    const o = projectOptions(items, projects, null)
    expect(o.map((x) => [x.key, x.count])).toEqual([
      [null, 4],
      ['a', 2],
      ['b', 0],
      ['', 1]
    ])
    expect(projectOptions([t('T-1', 'a')], projects, null).some((x) => x.key === '')).toBe(false)
    expect(projectOptions([t('T-1', 'a')], projects, '').some((x) => x.key === '')).toBe(true)
  })
})
