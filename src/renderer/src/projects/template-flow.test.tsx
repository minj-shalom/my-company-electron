import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { OrgMember, OrgSnapshot } from '../../../shared/org'
import type { ProjectTemplateInfo } from '../../../shared/project-template'
import type { EmployeeTemplateInfo } from '../../../shared/employee-change'
import { MOCK_TEMPLATES } from '../mock-hire'
import { mockProjectTemplateApi } from '../mock-project-templates'
import { StaffStep, TemplateStep } from './TemplateSteps'
import { buildStaffRows, emptyProgress, runTemplateSetup, type SetupInput } from './template-flow'

const member = (title: string, agentId: string): OrgMember => ({
  title,
  kind: 'agent',
  agentId,
  fileExists: true,
  department: '개발팀',
  reportsTo: 'COO',
  role: ''
})
const snapshot = (members: OrgMember[]): OrgSnapshot =>
  ({
    org: {
      members,
      departments: [{ name: '개발팀', members: members.map((m) => m.title) }],
      tree: []
    },
    agents: members.map((m) => ({
      id: m.agentId ?? '',
      name: m.title,
      description: '',
      model: null,
      tools: []
    })),
    missingBaseRoles: []
  }) as unknown as OrgSnapshot

const catalog: EmployeeTemplateInfo[] = MOCK_TEMPLATES
const templates = async (): Promise<ProjectTemplateInfo[]> => {
  const r = await mockProjectTemplateApi.listProjectTemplates()
  if (!r.ok) throw new Error('mock')
  return r.value
}

const okRecord = (
  id: string
): { ok: true; value: { record: { employeeId: string }; warnings: [] } } => ({
  ok: true as const,
  value: { record: { employeeId: id }, warnings: [] }
})

describe('buildStaffRows', () => {
  it('reuses an existing PM and same-id staff, hires the rest', async () => {
    const t = (await templates())[0]
    const rows = buildStaffRows(
      t,
      catalog,
      snapshot([member('PM', 'pm'), member('개발자', 'developer')])
    )
    expect(rows.map((r) => [r.templateId, r.mode, r.employeeId])).toEqual([
      ['pm-dev', 'reuse', 'pm'],
      ['developer', 'reuse', 'developer'],
      ['reviewer-qa', 'hire', null]
    ])
  })
  it('hires the PM profile when no PM exists', async () => {
    const t = (await templates())[1]
    const rows = buildStaffRows(t, catalog, snapshot([member('개발자', 'developer')]))
    expect(rows[0]).toMatchObject({ templateId: 'pm-content', mode: 'hire', isPm: true })
  })
})

describe('runTemplateSetup', () => {
  const setup = async (members: OrgMember[]): Promise<SetupInput> => {
    const t = (await templates())[0]
    const snap = snapshot(members)
    const input: SetupInput = {
      path: '/x/app',
      name: '앱',
      template: t,
      rows: buildStaffRows(t, catalog, snap),
      catalog,
      snapshot: snap
    }
    return input
  }
  const apiOf = (over: Record<string, unknown> = {}): Record<string, ReturnType<typeof vi.fn>> => ({
    addProject: vi.fn(async () => ({ ok: true as const, value: { project: { id: 'app' } } })),
    applyProjectTemplate: vi.fn(async () => ({ ok: true as const, value: {} })),
    createEmployee: vi.fn(async (req: { id: string }) => okRecord(req.id)),
    assignProjectEmployee: vi.fn(async () => ({ ok: true as const, value: {} })),
    setProjectPm: vi.fn(async () => ({ ok: true as const, value: {} })),
    ...over
  })

  it('runs add -> policy -> hire -> assign -> pm in order', async () => {
    const api = apiOf()
    const input = await setup([member('COO', 'coo')])
    const p = await runTemplateSetup(api as never, input, emptyProgress(), 'development')
    expect(p.failed).toBeNull()
    expect(api.createEmployee).toHaveBeenCalledTimes(3)
    expect(api.setProjectPm).toHaveBeenCalledWith({ id: 'app', pm: 'pm-dev' })
    expect(api.assignProjectEmployee).toHaveBeenCalledTimes(2)
  })

  it('stops on failure and retry does not hire again or re-add the project', async () => {
    let n = 0
    const api = apiOf({
      assignProjectEmployee: vi.fn(async () =>
        n++ === 0
          ? { ok: false as const, code: 'internal', message: 'x' }
          : { ok: true as const, value: {} }
      )
    })
    const input = await setup([member('COO', 'coo')])
    const first = await runTemplateSetup(api as never, input, emptyProgress(), 'development')
    expect(first.failed).toBe('developer')
    expect(first.message).toContain('이어서')
    expect(first.message).not.toMatch(/internal|x$/)
    const second = await runTemplateSetup(api as never, input, first, 'development')
    expect(second.failed).toBeNull()
    expect(api.addProject).toHaveBeenCalledTimes(1)
    expect(api.createEmployee).toHaveBeenCalledTimes(3)
    expect(api.setProjectPm).toHaveBeenCalledTimes(1)
  })

  it('keeps an existing policy file and continues (conflict)', async () => {
    const api = apiOf({
      applyProjectTemplate: vi.fn(async () => ({
        ok: false as const,
        code: 'conflict',
        message: 'm'
      }))
    })
    const input = await setup([
      member('PM', 'pm'),
      member('개발자', 'developer'),
      member('QA', 'reviewer-qa')
    ])
    const p = await runTemplateSetup(api as never, input, emptyProgress(), 'development')
    expect(p.policy).toBe('kept')
    expect(p.failed).toBeNull()
    expect(api.createEmployee).not.toHaveBeenCalled()
  })

  it('does not create the project twice when adding fails, and says so plainly', async () => {
    const api = apiOf({
      addProject: vi.fn(async () => ({
        ok: false as const,
        code: 'internal',
        message: '/secret/path'
      }))
    })
    const p = await runTemplateSetup(api as never, await setup([]), emptyProgress(), 'development')
    expect(p.projectId).toBeNull()
    expect(p.message).not.toContain('/secret')
    expect(api.createEmployee).not.toHaveBeenCalled()
  })

  it('explains hire conflict without creating a duplicate', async () => {
    const api = apiOf({
      createEmployee: vi.fn(async () => ({ ok: false as const, code: 'conflict', message: 'm' }))
    })
    const p = await runTemplateSetup(api as never, await setup([]), emptyProgress(), 'development')
    expect(p.failed).toBe('pm-dev')
    expect(p.message).toContain('이미 있어서')
    expect(api.createEmployee).toHaveBeenCalledTimes(1)
  })
})

describe('template screens', () => {
  it('renders cards with a no-template option and radio labels', async () => {
    const ts = (await templates()).slice(0, 1)
    const html = renderToStaticMarkup(
      <TemplateStep
        load={{ kind: 'ready', templates: ts }}
        templates={ts}
        selected="dev-web-app"
        disabled={false}
        onSelect={() => {}}
        onRetry={() => {}}
      />
    )
    expect(html).toContain('웹 앱 개발')
    expect(html).toContain('템플릿 없이 시작')
    expect(html).toContain('type="radio"')
    expect(html).toContain('기본 규칙')
  })
  it('shows loading and error states', () => {
    const render = (load: Parameters<typeof TemplateStep>[0]['load']): string =>
      renderToStaticMarkup(
        <TemplateStep
          load={load}
          templates={[]}
          selected="none"
          disabled={false}
          onSelect={() => {}}
          onRetry={() => {}}
        />
      )
    expect(render({ kind: 'loading' })).toContain('불러오고 있어요')
    expect(render({ kind: 'error' })).toContain('role="alert"')
    expect(render({ kind: 'ready', templates: [] })).toContain('아직 없어요')
  })
  it('marks reuse vs hire, warns when PM is unchecked, shows progress', async () => {
    const t = (await templates())[0]
    const rows = buildStaffRows(t, catalog, snapshot([member('개발자', 'developer')]))
    const html = renderToStaticMarkup(
      <StaffStep
        rows={rows}
        checked={new Set(['developer'])}
        disabled={false}
        progress={null}
        onToggle={() => {}}
      />
    )
    expect(html).toContain('이미 있음, 그대로 사용')
    expect(html).toContain('새로 채용')
    expect(html).toContain('PM 필요')
    const p = { ...emptyProgress(), projectId: 'a', assigned: { developer: true } }
    const run = renderToStaticMarkup(
      <StaffStep
        rows={rows}
        checked={new Set(['developer'])}
        disabled={false}
        progress={p}
        onToggle={() => {}}
      />
    )
    expect(run).toContain('완료')
  })
})
