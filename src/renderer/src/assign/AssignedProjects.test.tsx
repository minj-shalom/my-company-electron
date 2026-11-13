import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { OrgSnapshot } from '../../../shared/org'
import { mockGetOrg } from '../mock-org'
import { AssignedProjects } from './AssignedProjects'
import { AssignmentIssues } from './AssignmentIssues'
import { ProjectPeople } from './ProjectPeople'
import { UnassignedSection } from './UnassignedSection'

const load = async (s: 'normal' | 'no-hr' = 'normal'): Promise<OrgSnapshot> => {
  const r = await mockGetOrg(s)()
  if (!r.ok) throw new Error('mock')
  return structuredClone(r.value)
}
const noop = (): void => {}

describe('AssignedProjects', () => {
  it('shows 배정 대기 and the manual area folded for an unassigned employee', async () => {
    const snap = await load()
    const member = snap.org.members.find((m) => m.agentId === 'cto')!
    const html = renderToStaticMarkup(
      <AssignedProjects member={member} snapshot={snap} onChanged={noop} />
    )
    expect(html).toContain('배정 대기')
    expect(html).toContain('<details')
    expect(html).not.toContain('<details class="assigned__manual" open')
    expect(html).toContain('인사팀에 요청')
  })
  it('names role in text and opens the manual area when requested', async () => {
    const snap = await load('no-hr')
    snap.agents = snap.agents.map((a) =>
      a.id === 'pm' ? { ...a, projects: [{ id: 'a', name: '<b>앱</b>', role: 'pm' as const }] } : a
    )
    const member = snap.org.members.find((m) => m.agentId === 'pm')!
    const html = renderToStaticMarkup(
      <AssignedProjects member={member} snapshot={snap} defaultOpen onChanged={noop} />
    )
    expect(html).toContain('PM')
    expect(html).toContain('&lt;b&gt;앱&lt;/b&gt;')
    expect(html).toContain('open')
    expect(html).toContain('인사팀이 없어서')
  })
  it('does not offer assignment for CEO/COO', async () => {
    const snap = await load()
    const coo = snap.org.members.find((m) => m.title === 'COO')!
    const html = renderToStaticMarkup(
      <AssignedProjects member={coo} snapshot={snap} onChanged={noop} />
    )
    expect(html).toContain('프로젝트 배정 대상이 아니에요')
    expect(html).not.toContain('<details')
  })
})

describe('other assignment views', () => {
  it('UnassignedSection: loading, error, empty, list', async () => {
    expect(renderToStaticMarkup(<UnassignedSection org={null} failed={false} />)).toContain(
      '불러오고'
    )
    expect(renderToStaticMarkup(<UnassignedSection org={null} failed />)).toContain('role="alert"')
    const snap = await load()
    expect(renderToStaticMarkup(<UnassignedSection org={snap} failed={false} />)).toContain('CTO')
    snap.agents = snap.agents.map((a) => ({ ...a, projects: [{ id: 'a', name: '앱' }] }))
    snap.org.members = snap.org.members.filter(
      (m) => m.kind !== 'agent' || snap.agents.some((a) => a.id === m.agentId)
    )
    expect(renderToStaticMarkup(<UnassignedSection org={snap} failed={false} />)).toContain(
      '모든 직원이 프로젝트에 배정'
    )
  })
  it('ProjectPeople: empty state and read-only for archived', async () => {
    const base = {
      id: 'a',
      name: '앱',
      type: 'development' as const,
      path: '/x',
      devCommand: null,
      defaultBranch: null,
      pmId: null,
      pm: null,
      git: { status: 'not-repo' as const }
    }
    const html = renderToStaticMarkup(
      <ProjectPeople
        project={{ ...base, status: 'archived', state: 'archived' }}
        org={null}
        onChanged={noop}
      />
    )
    expect(html).toContain('아직 함께 일하는 직원이 없어요')
    expect(html).not.toContain('<details')
  })
  it('AssignmentIssues renders nothing without issues', () => {
    expect(renderToStaticMarkup(<AssignmentIssues issues={[]} />)).toBe('')
    expect(
      renderToStaticMarkup(
        <AssignmentIssues
          issues={[{ code: 'unknown-employee', projectId: 'a', employeeId: 'g', role: 'member' }]}
        />
      )
    ).toContain('1건')
  })
})
