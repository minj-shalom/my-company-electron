import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ProjectInfo } from '../../../shared/project'
import type { Ticket } from '../../../shared/ticket'
import { createMockTicketApi } from '../mock-tickets'
import { TicketFormBody } from './TicketFormDialog'
import type { FormOptions } from './ticket-form-model'

const project = (over: Partial<ProjectInfo>): ProjectInfo => ({
  id: 'a',
  name: '앱',
  type: 'development',
  path: '/x',
  devCommand: null,
  defaultBranch: null,
  status: 'active',
  pmId: 'pm',
  pm: null,
  state: 'ready',
  git: { status: 'not-repo' },
  ...over
})
const options: FormOptions = {
  projects: [
    project({}),
    project({ id: 'old', name: '옛', status: 'archived', state: 'archived' })
  ],
  employees: [{ id: 'pm', name: '피엠', title: 'PM' }],
  projectsFailed: false,
  employeesFailed: false
}
const noop = (): void => {}
const render = (
  mode: Parameters<typeof TicketFormBody>[0]['mode'],
  o: FormOptions | null,
  withPm = false
): string =>
  renderToStaticMarkup(
    <TicketFormBody
      mode={mode}
      titleId="t"
      options={o}
      onClose={noop}
      onSaved={noop}
      onAssignPm={withPm ? noop : undefined}
    />
  )

const backlog: Ticket = {
  id: 'T-004',
  title: '<b>랜딩</b>',
  status: 'backlog',
  assignee: 'ghost',
  department: '개발팀',
  body: '## 목표\n초안\n\n## 완료 조건\n- [ ] 첫째\n- [ ] 둘째\n'
}

describe('TicketFormBody', () => {
  it('shows a loading state while options load', () => {
    const html = render({ kind: 'create' }, null)
    expect(html).toContain('role="status"')
    expect(html).toContain('불러오고 있어요')
  })
  it('renders a labelled create form with counters and criteria controls', () => {
    const html = render({ kind: 'create' }, options)
    for (const label of ['제목', '목표', '프로젝트', '담당', '완료 조건 1'])
      expect(html).toContain(label)
    expect(html).toContain('0 / 100자')
    expect(html).toContain('0 / 2000자')
    expect(html).toContain('항목 추가')
    expect(html).toContain('완료 조건 1 삭제')
    expect(html).toContain('회사 공통')
    expect(html).not.toContain('보관됨')
    expect(html).toContain('티켓 만들기')
  })
  it('prefills edit values, escapes text and keeps an unknown assignee', () => {
    const html = render({ kind: 'edit', ticket: backlog }, options)
    expect(html).toContain('T-004 편집')
    expect(html).toContain('&lt;b&gt;랜딩&lt;/b&gt;')
    expect(html).not.toContain('<b>랜딩')
    expect(html).toContain('첫째')
    expect(html).toContain('둘째')
    expect(html).toContain('ghost (조직에 없음)')
    expect(html).toContain('>저장<')
  })
  it('warns when option lists failed to load but keeps the form usable', () => {
    const html = render(
      { kind: 'create' },
      { ...options, projects: [], employees: [], projectsFailed: true, employeesFailed: true }
    )
    expect(html).toContain('회사 공통')
    expect(html).toContain('프로젝트 목록을 불러오지 못해')
    expect(html).toContain('직원 목록을 불러오지 못해')
  })
  it('does not show the PM-required note for ready projects', () => {
    expect(render({ kind: 'create' }, options, true)).not.toContain('PM이 없어서')
  })
})

describe('mock ticket create/update', () => {
  const fields = { title: '새 일', goal: '목표', criteria: ['조건'], department: null }
  it('creates with the next number and edits only backlog tickets', async () => {
    const { api } = createMockTicketApi('samples')
    const c = await api.createTicket({ ...fields, assignee: null, projectId: 'a' })
    expect(c.ok && c.value.id).toBe('T-005')
    if (!c.ok) return
    expect(c.value.body).toContain('- **프로젝트:** a')
    const u = await api.updateTicket({
      id: c.value.id,
      expectedBody: c.value.body,
      ...fields,
      title: '바뀐 일',
      assignee: 'pm',
      projectId: null
    })
    expect(u.ok && u.value.title).toBe('바뀐 일')
    const stale = await api.updateTicket({
      id: c.value.id,
      expectedBody: c.value.body,
      ...fields,
      assignee: null,
      projectId: null
    })
    expect(!stale.ok && stale.code).toBe('conflict')
    const done = await api.updateTicket({
      id: 'T-001',
      expectedBody: '',
      ...fields,
      assignee: null,
      projectId: null
    })
    expect(!done.ok && done.code).toBe('forbidden')
  })
  it('returns conflict or internal in the matching scenarios', async () => {
    const conflict = createMockTicketApi('conflict').api
    const t = await conflict.getTicket('T-003')
    if (!t.ok) throw new Error('missing')
    const u = await conflict.updateTicket({
      id: 'T-003',
      expectedBody: t.value.body,
      ...fields,
      assignee: null,
      projectId: null
    })
    expect(!u.ok && u.code).toBe('conflict')
    const err = await createMockTicketApi('saveerror').api.createTicket(fields)
    expect(!err.ok && err.code).toBe('internal')
  })
})
