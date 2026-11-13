import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ProjectInfo } from '../../../shared/project'
import type { RecurringItem } from '../../../shared/recurring'
import { RecurringForm } from './RecurringForm'
import { RecurringSection } from './RecurringSection'
import type { RecurringLoad } from './recurring-model'

const project = (over: Partial<ProjectInfo> = {}): ProjectInfo => ({
  id: 'p',
  name: '<i>블로그</i>',
  type: 'content',
  path: '/x',
  devCommand: null,
  defaultBranch: null,
  status: 'active',
  pmId: 'pm',
  pm: { id: 'pm', name: 'PM' },
  state: 'ready',
  git: { status: 'not-repo' },
  ...over
})
const item: RecurringItem = {
  id: 'a',
  projectId: 'p',
  titleTemplate: '글 {date}',
  goalTemplate: '쓴다',
  criteriaTemplates: ['초안'],
  cadence: 'daily',
  count: 1,
  assignee: null,
  status: 'active',
  nextRunAt: 5_000,
  createdToday: false
}
const noop = (): void => {}
const view = (
  load: RecurringLoad,
  opts: { projects?: ProjectInfo[]; goals?: [string, number][] } = {}
): string =>
  renderToStaticMarkup(
    <RecurringSection
      load={load}
      goals={new Map(opts.goals ?? [])}
      refreshing={false}
      reload={noop}
      projects={opts.projects ?? [project()]}
      people={[]}
      now={1_000}
    />
  )
const ready = (items: RecurringItem[], unreadable = 0, overLimit = 0): RecurringLoad => ({
  kind: 'ready',
  list: { items, unreadable, overLimit }
})

describe('RecurringSection states', () => {
  it('loading, error, empty', () => {
    expect(view({ kind: 'loading' })).toContain('불러오고 있어요')
    const err = view({ kind: 'error', message: '실패' })
    expect(err).toContain('role="alert"')
    expect(err).toContain('다시 시도')
    expect(view(ready([]))).toContain('아직 반복 업무가 없어요')
  })
  it('escapes text and shows paused/next-run', () => {
    const html = view(ready([item, { ...item, id: 'b', status: 'paused', nextRunAt: null }]))
    expect(html).not.toContain('<i>')
    expect(html).toContain('일시정지')
    expect(html).toContain('다시 시작')
    expect(html).toContain('이후')
  })
  it('explains PM-needed and archived projects', () => {
    expect(view(ready([item]), { projects: [project({ state: 'pm-required' })] })).toContain(
      'PM이 없어서'
    )
    expect(
      view(ready([item]), { projects: [project({ status: 'archived', state: 'archived' })] })
    ).toContain('보관된 프로젝트')
  })
  it('shows goal mismatch, unreadable and overLimit', () => {
    const html = view(ready([item], 2, 3), { goals: [['p', 3]] })
    expect(html).toContain('개수가 달라요')
    expect(html).toContain('읽지 못한 반복 업무 2건')
    expect(html).toContain('3건은 티켓을 만들지 않아요')
    expect(view(ready([item]), { goals: [['p', 1]] })).not.toContain('개수가 달라요')
  })
  it('hides ticket jargon', () => {
    expect(view(ready([item]))).not.toMatch(/materialize|recurring\.md|cadence/)
  })
})

describe('RecurringForm', () => {
  const form = renderToStaticMarkup(
    <RecurringForm
      editing={null}
      projects={[project()]}
      people={[{ id: 'dev', name: '개발자' }]}
      busy={false}
      error={null}
      onCancel={noop}
      onSubmit={noop}
    />
  )
  it('labels every field and explains {date}', () => {
    for (const l of [
      '프로젝트',
      '티켓 제목',
      '목표',
      '완료 조건',
      '주기',
      '한 번에 만들 개수',
      '담당'
    ])
      expect(form).toContain(l)
    expect(form).toContain('{date}')
    expect(form).toContain('프로젝트의 담당 PM')
  })
})
