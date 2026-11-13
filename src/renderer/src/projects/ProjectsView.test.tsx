import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ProjectInfo } from '../../../shared/project'
import { ProjectCard } from './ProjectCard'
import { ConfirmDialog, RenameDialog } from './ProjectDialogs'
import { ProjectFilter } from './ProjectFilter'
import { PmFields } from './PmFields'
import { ProjectsView } from './ProjectsView'
import type { UseProjects } from './use-projects'

const p = (over: Partial<ProjectInfo> = {}): ProjectInfo => ({
  id: 'a',
  name: '<b>앱</b>',
  type: 'development',
  path: '/x/a',
  devCommand: null,
  defaultBranch: null,
  status: 'active',
  pmId: null,
  pm: null,
  state: 'pm-required',
  git: { status: 'unavailable', branch: 'feature/x' },
  ...over
})
const noop = (): void => {}
const view = (load: UseProjects['load'], refreshing = false): string =>
  renderToStaticMarkup(
    <ProjectsView load={load} refreshing={refreshing} reload={noop} currentId={null} />
  )
const ready = (
  items: ProjectInfo[],
  format: 'blocks' | 'legacy' | 'empty' = 'blocks'
): UseProjects['load'] => ({
  kind: 'ready',
  list: { items, unreadable: [], format },
  pms: []
})

describe('ProjectsView states', () => {
  it('loading', () => {
    expect(view({ kind: 'loading' })).toContain('불러오고 있어요')
  })
  it('error with retry', () => {
    const html = view({ kind: 'error', message: '실패' })
    expect(html).toContain('role="alert"')
    expect(html).toContain('다시 시도')
  })
  it('empty', () => {
    expect(view(ready([], 'empty'))).toContain('아직 등록한 프로젝트가 없어요')
  })
  it('shows no script or file jargon; legacy note only when legacy', () => {
    const jargon = /스크립트|project\.md|scripts\/|dev_command|project_dir|dev 명령|기본 브랜치/
    expect(view(ready([p()]))).not.toMatch(jargon)
    expect(view(ready([p()]))).not.toContain('이전 형식')
    const legacy = view(ready([p()], 'legacy'))
    expect(legacy).toContain('이전 형식')
    expect(legacy).not.toMatch(jargon)
  })
  it('hides archived behind a toggle and unreadable shows a notice', () => {
    const html = view({
      kind: 'ready',
      pms: [],
      list: {
        items: [p(), p({ id: 'b', status: 'archived', state: 'archived' })],
        unreadable: [{ line: 3, reason: 'invalid-block' }],
        format: 'blocks'
      }
    })
    expect(html).toContain('보관된 프로젝트 1건 보기')
    expect(html).toContain('읽지 못한 프로젝트 블록 1건')
    expect(html).toContain('프로젝트 설정 3번째 항목')
    expect(html).not.toContain('project.md')
  })
})

describe('ProjectCard', () => {
  const html = (x: ProjectInfo): string =>
    renderToStaticMarkup(<ProjectCard project={x} current={false} onAction={noop} />)
  it('escapes names and shows branch when git is unavailable', () => {
    const out = html(p())
    expect(out).not.toContain('<b>앱')
    expect(out).toContain('feature/x')
    expect(out).toContain('변경 여부 알 수 없음')
  })
  it('warns and offers PM assignment when PM is required', () => {
    const out = html(p())
    expect(out).toContain('PM 필요')
    expect(out).toContain('담당 PM 지정')
    expect(out).toContain('티켓이 실행되지 않아요')
    expect(out).not.toContain('PM 해제')
  })
  it('shows PM name with change and clear actions', () => {
    const out = html(p({ pmId: 'pm', pm: { id: 'pm', name: '민수' }, state: 'ready' }))
    expect(out).toContain('민수')
    expect(out).toContain('PM 변경')
    expect(out).toContain('PM 해제')
  })
  it('archived projects can only be restored', () => {
    const out = html(p({ status: 'archived', state: 'archived' }))
    expect(out).toContain('복원')
    expect(out).not.toContain('>보관<')
  })
})

describe('dialogs and fields', () => {
  it('pm fields default to hire when no PM exists', () => {
    const out = renderToStaticMarkup(
      <PmFields pms={[]} choice={{ kind: 'hire' }} onChange={noop} />
    )
    expect(out).toContain('인사팀에 PM 채용 요청')
    expect(out).toContain('나중에 정하기')
  })
  it('pm fields hide hire when PMs exist and mark the first as recommended', () => {
    const out = renderToStaticMarkup(
      <PmFields
        pms={[
          { id: 'a', name: '가' },
          { id: 'b', name: '나' }
        ]}
        choice={{ kind: 'existing', id: 'a' }}
        onChange={noop}
      />
    )
    expect(out).not.toContain('인사팀에 PM 채용 요청')
    expect(out).toContain('추천')
  })
  it('confirm dialog shows reason and hint on failure', () => {
    const out = renderToStaticMarkup(
      <ConfirmDialog
        title="프로젝트 보관"
        confirmLabel="보관"
        busy={false}
        error={{
          ok: false,
          message: '진행 중인 티켓이 있어요.',
          detail: '소속이 지정되지 않은 티켓'
        }}
        onConfirm={noop}
        onCancel={noop}
      >
        <p>본문</p>
      </ConfirmDialog>
    )
    expect(out).toContain('진행 중인 티켓이 있어요.')
    expect(out).toContain('소속이 지정되지 않은 티켓')
    expect(out).toContain('role="alert"')
  })
  it('rename dialog flags invalid names', () => {
    const out = renderToStaticMarkup(
      <RenameDialog current="a#b" busy={false} error={null} onSubmit={noop} onCancel={noop} />
    )
    expect(out).toContain('aria-invalid="true"')
  })
  it('filter lists only active projects and says it is a view filter', () => {
    const out = renderToStaticMarkup(
      <ProjectFilter
        items={[p({ id: 'a', name: 'A' }), p({ id: 'b', name: 'B', status: 'archived' })]}
        value={null}
        onChange={noop}
      />
    )
    expect(out).toContain('전체')
    expect(out).toContain('>A<')
    expect(out).not.toContain('>B<')
    expect(out).toContain('보기 필터일 뿐')
  })
})
