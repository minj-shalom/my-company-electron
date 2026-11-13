import { describe, expect, it, vi } from 'vitest'
import type { ProjectInfo } from '../../../shared/project'
import {
  addProjectFlow,
  archiveProject,
  assignPm,
  defaultPmChoice,
  gitView,
  projectErrorText,
  rankPms,
  resolveCurrent,
  suggestName,
  validateAddForm
} from './project-model'

const proj = (over: Partial<ProjectInfo> = {}): ProjectInfo => ({
  id: 'a',
  name: 'A',
  type: 'development',
  path: '/x/a',
  devCommand: null,
  defaultBranch: null,
  status: 'active',
  pmId: null,
  pm: null,
  state: 'pm-required',
  git: { status: 'ok', branch: 'main', dirty: false },
  ...over
})
const changed = (p = proj()): { ok: true; value: { record: never; project: ProjectInfo } } => ({
  ok: true,
  value: { record: {} as never, project: p }
})

describe('gitView', () => {
  it('shows branch and dirty state', () => {
    expect(gitView(proj({ git: { status: 'ok', branch: 'dev', dirty: true } }))).toMatchObject({
      branch: 'dev',
      dirtyText: '변경 있음'
    })
  })
  it('shows branch when git is unavailable but dirty is unknown', () => {
    const v = gitView(proj({ git: { status: 'unavailable', branch: 'feature/x' } }))
    expect(v.branch).toBe('feature/x')
    expect(v.dirtyText).toBe('변경 여부 알 수 없음')
  })
  it('handles unavailable without branch, not-repo and missing', () => {
    expect(gitView(proj({ git: { status: 'unavailable' } })).branch).toBeNull()
    expect(gitView(proj({ type: 'content', git: { status: 'not-repo' } })).branchText).toContain(
      '정상'
    )
    expect(gitView(proj({ git: { status: 'not-repo' } })).tone).toBe('warn')
    expect(gitView(proj({ git: { status: 'missing' } })).tone).toBe('bad')
  })
})

describe('projectErrorText', () => {
  it('keeps the fixed reason for rule violations', () => {
    expect(projectErrorText('conflict', '진행 중인 티켓이 있어 보관할 수 없어요.')).toContain(
      '진행 중인 티켓'
    )
  })
  it('uses code text for others and hides internals', () => {
    expect(projectErrorText('internal', '/Users/x/secret')).not.toContain('/Users')
    expect(projectErrorText('path-not-allowed', 'x')).toContain('폴더 선택 창')
    expect(projectErrorText('conflict', 'x'.repeat(300))).not.toContain('xxx')
  })
})

describe('pm ranking', () => {
  it('prefers the PM with fewer active projects', () => {
    const items = [proj({ id: 'a', pmId: 'busy' }), proj({ id: 'b', pmId: 'busy' })]
    const pms = [
      { id: 'busy', name: 'A' },
      { id: 'free', name: 'B' }
    ]
    expect(rankPms(pms, items).map((p) => p.id)).toEqual(['free', 'busy'])
  })
  it('defaults to hire when the company has no PM', () => {
    expect(defaultPmChoice([])).toEqual({ kind: 'hire' })
    expect(defaultPmChoice([{ id: 'pm', name: 'pm' }])).toEqual({ kind: 'existing', id: 'pm' })
  })
})

describe('misc', () => {
  it('resets the current project when it is gone or archived', () => {
    const items = [proj({ id: 'a' }), proj({ id: 'b', status: 'archived' })]
    expect(resolveCurrent('a', items)).toBe('a')
    expect(resolveCurrent('b', items)).toBeNull()
    expect(resolveCurrent('zzz', items)).toBeNull()
  })
  it('suggests a name only when valid', () => {
    expect(suggestName('/x/my-app')).toBe('my-app')
    expect(suggestName('/x/a#b')).toBe('')
  })
  it('validates the add form', () => {
    expect(validateAddForm({ name: '', devCommand: '', defaultBranch: '' }).name).toBeDefined()
    expect(validateAddForm({ name: 'ok', devCommand: '', defaultBranch: '' })).toEqual({})
  })
})

describe('archiveProject', () => {
  it('adds the unassigned-ticket hint on conflict', async () => {
    const r = await archiveProject(
      {
        archiveProject: async () => ({
          ok: false,
          code: 'conflict',
          message: '진행 중인 티켓이 있어 보관할 수 없어요.'
        })
      },
      'a'
    )
    expect(r).toMatchObject({ ok: false })
    expect(r.ok === false && r.detail).toContain('소속이 지정되지 않은')
  })
  it('turns thrown errors into a message', async () => {
    const r = await archiveProject({ archiveProject: () => Promise.reject(new Error('x')) }, 'a')
    expect(r.ok).toBe(false)
  })
})

describe('addProjectFlow', () => {
  const input = {
    path: '/x/a',
    name: 'A',
    type: 'development' as const,
    devCommand: ' npm run dev ',
    defaultBranch: '',
    pm: { kind: 'later' as const }
  }
  it('sends trimmed optional fields and only the dialog path', async () => {
    const addProject = vi.fn(async () => changed())
    const out = await addProjectFlow({ addProject, hirePm: vi.fn(), setProjectPm: vi.fn() }, input)
    expect(addProject).toHaveBeenCalledWith({
      path: '/x/a',
      name: 'A',
      type: 'development',
      devCommand: 'npm run dev'
    })
    expect(out).toMatchObject({ kind: 'done' })
    expect(out.message).toContain('PM 필요')
  })
  it('does not send dev fields for content projects', async () => {
    const addProject = vi.fn(async () => changed())
    await addProjectFlow(
      { addProject, hirePm: vi.fn(), setProjectPm: vi.fn() },
      { ...input, type: 'content' }
    )
    expect(addProject).toHaveBeenCalledWith({ path: '/x/a', name: 'A', type: 'content' })
  })
  it('passes an existing PM with the add request', async () => {
    const addProject = vi.fn(async () => changed())
    await addProjectFlow(
      { addProject, hirePm: vi.fn(), setProjectPm: vi.fn() },
      { ...input, pm: { kind: 'existing', id: 'pm' } }
    )
    expect(addProject).toHaveBeenCalledWith(expect.objectContaining({ pm: 'pm' }))
  })
  it('hires then assigns the PM', async () => {
    const hirePm = vi.fn(async () => ({
      ok: true as const,
      value: { employeeId: 'pm', record: {} as never }
    }))
    const setProjectPm = vi.fn(async () => changed())
    const out = await addProjectFlow(
      { addProject: async () => changed(), hirePm, setProjectPm },
      { ...input, pm: { kind: 'hire' } }
    )
    expect(setProjectPm).toHaveBeenCalledWith({ id: 'a', pm: 'pm' })
    expect(out.kind).toBe('done')
  })
  it('reports partial success when hiring fails after the project was added', async () => {
    const out = await addProjectFlow(
      {
        addProject: async () => changed(),
        hirePm: async () => ({ ok: false, code: 'internal', message: 'x' }),
        setProjectPm: vi.fn()
      },
      { ...input, pm: { kind: 'hire' } }
    )
    expect(out.kind).toBe('partial')
    expect(out.message).toContain('담당 PM 지정')
  })
  it('returns error and skips PM steps when add fails', async () => {
    const hirePm = vi.fn()
    const out = await addProjectFlow(
      {
        addProject: async () => ({ ok: false, code: 'conflict', message: '이미 등록된 폴더예요.' }),
        hirePm,
        setProjectPm: vi.fn()
      },
      { ...input, pm: { kind: 'hire' } }
    )
    expect(out).toEqual({ kind: 'error', message: '이미 등록된 폴더예요.' })
    expect(hirePm).not.toHaveBeenCalled()
  })
})

describe('assignPm', () => {
  it('maps hire conflict to a guide to pick the existing PM', async () => {
    const r = await assignPm(
      {
        hirePm: async () => ({ ok: false, code: 'conflict', message: 'x' }),
        setProjectPm: vi.fn()
      },
      { id: 'a', name: 'A' },
      { kind: 'hire' }
    )
    expect(r.ok === false && r.message).toContain('기존 PM')
  })
})
