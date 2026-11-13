import { describe, expect, it } from 'vitest'
import { summarizeProjects, type ProjectRef } from './project-status'
import type { Ticket } from './ticket'

const proj = (id: string, state: ProjectRef['state'], pm = false): ProjectRef => ({
  id,
  name: id.toUpperCase(),
  state,
  pmId: pm ? 'pm' : null,
  pm: pm ? { id: 'pm', name: '피엠' } : null
})
const t = (
  n: number,
  status: Ticket['status'],
  projectId?: string | null
): Pick<Ticket, 'id' | 'title' | 'status' | 'projectId'> => ({
  id: `T-${n}`,
  title: `t${n}`,
  status,
  projectId
})

describe('summarizeProjects', () => {
  const projects = [
    proj('app', 'ready', true),
    proj('blog', 'pm-required'),
    proj('old', 'archived')
  ]
  const tickets = [
    t(1, 'done', 'app'),
    t(2, 'backlog', 'app'),
    t(3, 'in-progress', null),
    t(4, 'done'),
    t(5, 'backlog', 'ghost'),
    t(6, 'done', 'old'),
    t(7, 'done', 'app')
  ]
  const r = summarizeProjects(tickets, projects, ['T-2', 'T-5', 'T-99', null, 'T-3'])

  it('groups by project, company, unknown; hides empty archived', () => {
    expect(
      r.summaries.map((s) => s.scope.kind + ':' + ('projectId' in s.scope ? s.scope.projectId : ''))
    ).toEqual(['project:app', 'project:blog', 'project:old', 'company:', 'unknown:ghost'])
    expect(r.summaries[0].counts).toEqual({ backlog: 1, 'in-progress': 0, done: 2 })
    expect(r.summaries[0].pm?.name).toBe('피엠')
    expect(r.summaries[1].pmState).toBe('pm-required')
  })
  it('lists recent done newest first, capped at 5', () => {
    const many = Array.from({ length: 8 }, (_, i) => t(i + 1, 'done', 'app'))
    const s = summarizeProjects(many, projects, []).summaries[0]
    expect(s.recentDone.map((x) => x.id)).toEqual(['T-8', 'T-7', 'T-6', 'T-5', 'T-4'])
    expect(r.summaries[0].recentDone.map((x) => x.id)).toEqual(['T-7', 'T-1'])
  })
  it('counts pending decisions per scope and ignores unknown tickets', () => {
    expect(r.summaries.map((s) => s.pendingDecisions)).toEqual([1, 0, 0, 1, 1])
    expect(r.total.pendingDecisions).toBe(3)
  })
  it('totals and pm-required count', () => {
    expect(r.total.counts).toEqual({ backlog: 2, 'in-progress': 1, done: 4 })
    expect(r.pmRequiredCount).toBe(1)
  })
  it('omits an archived project with no tickets', () => {
    const s = summarizeProjects([], projects, [])
    expect(s.summaries.map((x) => x.scope.kind === 'project' && x.scope.projectId)).toEqual([
      'app',
      'blog'
    ])
  })
})
