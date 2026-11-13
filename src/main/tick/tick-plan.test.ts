import { describe, expect, it } from 'vitest'
import { agent, org, project, snapshot, ticket } from './tick-test-kit'
import { planTick } from './tick-plan'

describe('planTick', () => {
  it('picks the first runnable ticket, in-progress before backlog order given', () => {
    const plan = planTick(
      snapshot({ tickets: [ticket('T-002', { status: 'in-progress' }), ticket('T-001')] }),
      null
    )
    expect(plan.selected?.ticket.id).toBe('T-002')
    expect(plan.selected?.project).toBeNull()
  })

  it('returns nothing when there are no open tickets', () => {
    const plan = planTick(snapshot({ tickets: [ticket('T-001', { status: 'done' })] }), null)
    expect(plan.selected).toBeNull()
    expect(plan.skipped).toEqual([])
  })

  it('treats a missing or unknown assignee as hire needed, then moves on', () => {
    const plan = planTick(
      snapshot({
        tickets: [
          ticket('T-001', { assignee: null }),
          ticket('T-002', { assignee: 'ghost' }),
          ticket('T-003')
        ]
      }),
      null
    )
    expect(plan.skipped.map((s) => s.reason)).toEqual(['staff-missing', 'staff-missing'])
    expect(plan.effects.map((e) => e.type === 'hr' && e.kind)).toEqual(['hire', 'hire'])
    expect(plan.selected?.ticket.id).toBe('T-003')
  })

  it('does not run quarantined employees', () => {
    const plan = planTick(
      snapshot({ tickets: [ticket('T-001')], quarantined: new Set(['developer']) }),
      null
    )
    expect(plan.selected).toBeNull()
    expect(plan.skipped[0].reason).toBe('quarantined')
  })

  it('skips pm-required projects and asks hr for a PM', () => {
    const p = project('alpha', { pmId: null, pm: null, state: 'pm-required' })
    const plan = planTick(
      snapshot({ tickets: [ticket('T-001', { projectId: 'alpha' })], projects: [p] }),
      null
    )
    expect(plan.selected).toBeNull()
    expect(plan.skipped[0]).toMatchObject({
      reason: 'pm-required',
      note: 'PM 필요: 프로젝트 alpha'
    })
    expect(plan.effects[0]).toMatchObject({ type: 'hr', kind: 'pm-required', projectId: 'alpha' })
  })

  it('recomputes the project state from the org when the PM was removed', () => {
    // 프로젝트 파일은 pm을 가리키지만 조직도에는 PM이 없다 (참조가 깨짐). info.state가 오래돼도 믿지 않는다.
    const p = project('alpha', { pmId: 'pm', state: 'ready' })
    const plan = planTick(
      snapshot({
        org: org(agent('developer')),
        tickets: [ticket('T-001', { projectId: 'alpha' })],
        projects: [p]
      }),
      null
    )
    expect(plan.skipped[0].reason).toBe('pm-required')
  })

  it('treats an unreadable org as pm-required for project tickets but allows company-wide ones', () => {
    const p = project('alpha')
    const plan = planTick(
      snapshot({
        org: null,
        tickets: [ticket('T-001', { projectId: 'alpha' }), ticket('T-002')],
        projects: [p]
      }),
      null
    )
    expect(plan.skipped.map((s) => s.reason)).toContain('pm-required')
    expect(plan.skipped.map((s) => s.reason)).toContain('staff-missing')
  })

  it('proposes an assignment when the assignee is not on the project', () => {
    const p = project('alpha', { memberIds: [] })
    const plan = planTick(
      snapshot({ tickets: [ticket('T-001', { projectId: 'alpha' })], projects: [p] }),
      null
    )
    expect(plan.selected).toBeNull()
    expect(plan.skipped[0].reason).toBe('not-assigned')
    expect(plan.effects[0]).toEqual({
      type: 'assign',
      projectId: 'alpha',
      employeeId: 'developer',
      ticketId: 'T-001'
    })
  })

  it('lets the PM work on the project without an explicit member entry', () => {
    const p = project('alpha', { memberIds: [] })
    const plan = planTick(
      snapshot({
        tickets: [ticket('T-001', { projectId: 'alpha', assignee: 'pm' })],
        projects: [p]
      }),
      null
    )
    expect(plan.selected?.assignee).toBe('pm')
    expect(plan.selected?.pmId).toBe('pm')
  })

  it('selects a project ticket and delegates to the PM', () => {
    const p = project('alpha')
    const plan = planTick(
      snapshot({ tickets: [ticket('T-001', { projectId: 'alpha' })], projects: [p] }),
      null
    )
    expect(plan.selected?.project?.id).toBe('alpha')
    expect(plan.selected?.pmId).toBe('pm')
  })

  it('handles unknown, archived and unlisted projects', () => {
    const plan = planTick(
      snapshot({
        tickets: [ticket('T-001', { projectId: 'nope' }), ticket('T-002', { projectId: 'old' })],
        projects: [project('old', { status: 'archived', state: 'archived' })]
      }),
      null
    )
    expect(plan.skipped.map((s) => s.reason)).toEqual(['project-unknown', 'project-archived'])
    const unreadable = planTick(
      snapshot({ tickets: [ticket('T-001', { projectId: 'alpha' })], projects: null }),
      null
    )
    expect(unreadable.skipped[0].reason).toBe('project-unknown')
  })

  it('treats an empty allowed list as no projects, but company-wide tickets still run', () => {
    const p = project('alpha')
    const snap = snapshot({
      tickets: [ticket('T-001', { projectId: 'alpha' }), ticket('T-002')],
      projects: [p]
    })
    const none = planTick(snap, [])
    expect(none.skipped[0].reason).toBe('outside-hours')
    expect(none.selected?.ticket.id).toBe('T-002')
    expect(planTick(snap, ['alpha']).selected?.ticket.id).toBe('T-001')
    expect(planTick(snap, ['beta']).skipped[0].reason).toBe('outside-hours')
    expect(planTick(snap, null).selected?.ticket.id).toBe('T-001')
  })

  it('notes an overloaded PM and suggests another hire', () => {
    const ps = [project('a'), project('b'), project('c')]
    const plan = planTick(
      snapshot({ tickets: [ticket('T-001', { projectId: 'a' })], projects: ps }),
      null
    )
    expect(plan.notes[0]).toContain('PM 추가 채용')
    expect(plan.effects.some((e) => e.type === 'hr' && e.kind === 'pm-add')).toBe(true)
  })
})
