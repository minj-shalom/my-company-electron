import type { WindowApi } from '../../shared/api'
import {
  checkProjectName,
  isPmTitle,
  type ProjectChangeRecord,
  type ProjectChangeResult,
  type ProjectInfo,
  type ProjectList
} from '../../shared/project'
import type { ApiResult } from '../../shared/result'
import { mockGetOrg, parseOrgScenario } from './mock-org'

/**
 * 브라우저 개발 모드 전용. `?mock-projects=ok|empty|legacy|many|error|loading|slow|pm-none`.
 * ok: 기본 3건(PM 필요·보관·git 조회 불가 포함), empty: 없음, legacy: 기존 형식 안내, many: 12건,
 * error: 조회 실패, loading: 응답 없음, slow: 응답 지연, pm-none: 모든 프로젝트가 PM 없음.
 * 보관은 'landing'이 진행 중 티켓 때문에 거부된다.
 */
export type ProjectScenario =
  'ok' | 'empty' | 'legacy' | 'many' | 'error' | 'loading' | 'slow' | 'pm-none'
const SCENARIOS: readonly ProjectScenario[] = [
  'ok',
  'empty',
  'legacy',
  'many',
  'error',
  'loading',
  'slow',
  'pm-none'
]

export function parseProjectScenario(search: string): ProjectScenario {
  const v = new URLSearchParams(search).get('mock-projects')
  return SCENARIOS.find((s) => s === v) ?? 'ok'
}

type Mock = Pick<
  WindowApi,
  | 'selectProjectFolder'
  | 'listProjects'
  | 'addProject'
  | 'renameProject'
  | 'archiveProject'
  | 'restoreProject'
  | 'setProjectType'
  | 'setProjectPm'
  | 'clearProjectPm'
>

const base = (
  over: Partial<ProjectInfo> & Pick<ProjectInfo, 'id' | 'name' | 'path'>
): ProjectInfo => ({
  type: 'development',
  devCommand: 'npm run dev',
  defaultBranch: 'develop',
  status: 'active',
  pmId: 'pm',
  pm: null,
  state: 'ready',
  git: { status: 'ok', branch: 'develop', dirty: false },
  ...over
})

function seed(s: ProjectScenario): { items: ProjectInfo[]; format: ProjectList['format'] } {
  if (s === 'empty') return { items: [], format: 'empty' }
  const noPm = s === 'pm-none' ? null : 'pm'
  const main = [
    base({
      id: 'my-company',
      name: 'My Company',
      path: '/Users/demo/work/my-company',
      pmId: noPm,
      git: { status: 'ok', branch: 'feature/T-037', dirty: true }
    }),
    base({
      id: 'landing',
      name: '랜딩 페이지',
      path: '/Users/demo/work/my-company-landing',
      pmId: null
    }),
    base({
      id: 'blog',
      name: '블로그',
      type: 'content',
      devCommand: null,
      defaultBranch: null,
      path: '/Users/demo/work/blog',
      pmId: noPm,
      git: { status: 'not-repo' }
    }),
    base({
      id: 'video',
      name: '유튜브 콘텐츠',
      type: 'other',
      devCommand: null,
      defaultBranch: null,
      path: '/Users/demo/work/video',
      pmId: noPm,
      git: { status: 'unavailable', branch: 'main' }
    }),
    base({
      id: 'old-app',
      name: '옛날 앱',
      path: '/Users/demo/work/old-app',
      status: 'archived',
      pmId: noPm,
      git: { status: 'missing' }
    })
  ]
  if (s === 'many') {
    const extra = Array.from({ length: 8 }, (_, i) =>
      base({
        id: `app-${i + 1}`,
        name: `앱 ${i + 1}`,
        path: `/Users/demo/work/app-${i + 1}`,
        pmId: i % 3 === 0 ? null : 'pm'
      })
    )
    return { items: [...main, ...extra], format: 'blocks' }
  }
  return { items: main, format: s === 'legacy' ? 'legacy' : 'blocks' }
}

const record = (
  action: ProjectChangeRecord['action'],
  projectId: string,
  pmBefore: string | null,
  pmAfter: string | null
): ProjectChangeRecord => ({
  action,
  projectId,
  actor: 'ceo-ui',
  approval: null,
  pmBefore,
  pmAfter,
  changedFields: [action],
  at: '2026-11-13T09:00:00.000Z'
})

const fail = (
  code: 'conflict' | 'not-found' | 'invalid-request',
  message: string
): ApiResult<never> => ({
  ok: false,
  code,
  message
})

export function createMockProjectApi(
  scenario: ProjectScenario,
  delayMs: number,
  orgSearch: string
): { api: Mock; reset: () => void } {
  let state = seed(scenario)
  let folderSeq = 0
  const wait = (): Promise<void> =>
    new Promise((r) => setTimeout(r, scenario === 'slow' ? Math.max(delayMs, 1) * 5 : delayMs))

  // 조직도 mock이 PM 직급 직원을 돌려주는지로 PM 유효성을 판단한다 (채용 뒤 반영 포함).
  const validPm = async (id: string | null): Promise<{ id: string; name: string } | null> => {
    if (id === null) return null
    const r = await mockGetOrg(parseOrgScenario(orgSearch))()
    if (!r.ok) return null
    const m = r.value.org.members.find(
      (x) => x.kind === 'agent' && x.agentId === id && x.fileExists && isPmTitle(x.title)
    )
    return m ? { id, name: r.value.agents.find((a) => a.id === id)?.name ?? m.title } : null
  }
  const derive = async (p: ProjectInfo): Promise<ProjectInfo> => {
    const pm = await validPm(p.pmId)
    return {
      ...p,
      pm,
      state: p.status === 'archived' ? 'archived' : pm ? 'ready' : 'pm-required'
    }
  }
  const find = (id: string): ProjectInfo | undefined => state.items.find((p) => p.id === id)
  const changed = async (
    p: ProjectInfo,
    rec: ProjectChangeRecord
  ): Promise<ApiResult<ProjectChangeResult>> => ({
    ok: true,
    value: { record: rec, project: await derive(p) }
  })
  const update = (id: string, patch: Partial<ProjectInfo>): ProjectInfo => {
    const next = { ...(find(id) as ProjectInfo), ...patch }
    state = { ...state, items: state.items.map((p) => (p.id === id ? next : p)) }
    return next
  }

  return {
    reset: () => {
      state = seed(scenario)
      folderSeq = 0
    },
    api: {
      selectProjectFolder: async () => {
        await wait()
        folderSeq += 1
        return { ok: true, value: `/Users/demo/work/new-project-${folderSeq}` }
      },
      listProjects: async () => {
        if (scenario === 'loading') return new Promise<never>(() => {})
        await wait()
        if (scenario === 'error')
          return { ok: false, code: 'internal', message: '/Users/demo/secret/path 내부 오류' }
        return {
          ok: true,
          value: {
            items: await Promise.all(state.items.map(derive)),
            unreadable: scenario === 'many' ? [{ line: 42, reason: 'invalid-block' as const }] : [],
            format: state.items.length === 0 ? 'empty' : state.format
          }
        }
      },
      addProject: async (req) => {
        await wait()
        const nameError = checkProjectName(req.name)
        if (nameError) return fail('invalid-request', nameError)
        if (state.items.some((p) => p.name.toLowerCase() === req.name.toLowerCase()))
          return fail('conflict', '같은 이름의 프로젝트가 이미 있어요.')
        if ((req.type ?? 'development') === 'development' && req.path.endsWith('-3'))
          return fail(
            'invalid-request',
            'development 프로젝트는 git 레포 폴더(.git이 있는 최상위 폴더)여야 해요.'
          )
        const id = `p-${state.items.length + 1}`
        const p = base({
          id,
          name: req.name,
          path: req.path,
          type: req.type ?? 'development',
          devCommand: req.devCommand ?? null,
          defaultBranch: req.defaultBranch ?? null,
          pmId: req.pm ?? null,
          git:
            (req.type ?? 'development') === 'development'
              ? { status: 'ok', branch: 'main', dirty: false }
              : { status: 'not-repo' }
        })
        state = { format: 'blocks', items: [...state.items, p] }
        return changed(p, record('add', id, null, req.pm ?? null))
      },
      renameProject: async (req) => {
        await wait()
        const p = find(req.id)
        if (!p) return fail('not-found', '프로젝트를 찾지 못했어요.')
        const nameError = checkProjectName(req.name)
        if (nameError) return fail('invalid-request', nameError)
        if (
          state.items.some(
            (x) => x.id !== req.id && x.name.toLowerCase() === req.name.toLowerCase()
          )
        )
          return fail('conflict', '같은 이름의 프로젝트가 이미 있어요.')
        return changed(update(req.id, { name: req.name }), record('rename', req.id, p.pmId, p.pmId))
      },
      archiveProject: async (req) => {
        await wait()
        const p = find(req.id)
        if (!p) return fail('not-found', '프로젝트를 찾지 못했어요.')
        if (req.id === 'landing')
          return fail(
            'conflict',
            '진행 중인 티켓이 있어 보관할 수 없어요. 티켓을 마무리하거나 옮긴 뒤 다시 시도하세요.'
          )
        return changed(
          update(req.id, { status: 'archived' }),
          record('archive', req.id, p.pmId, p.pmId)
        )
      },
      restoreProject: async (req) => {
        await wait()
        const p = find(req.id)
        if (!p) return fail('not-found', '프로젝트를 찾지 못했어요.')
        return changed(
          update(req.id, { status: 'active' }),
          record('restore', req.id, p.pmId, p.pmId)
        )
      },
      setProjectType: async (req) => {
        await wait()
        const p = find(req.id)
        if (!p) return fail('not-found', '프로젝트를 찾지 못했어요.')
        return changed(
          update(req.id, { type: req.type }),
          record('set-type', req.id, p.pmId, p.pmId)
        )
      },
      setProjectPm: async (req) => {
        await wait()
        const p = find(req.id)
        if (!p) return fail('not-found', '프로젝트를 찾지 못했어요.')
        if (!(await validPm(req.pm)))
          return fail('invalid-request', 'PM 직급 직원만 담당 PM으로 지정할 수 있어요.')
        return changed(update(req.id, { pmId: req.pm }), record('set-pm', req.id, p.pmId, req.pm))
      },
      clearProjectPm: async (req) => {
        await wait()
        const p = find(req.id)
        if (!p) return fail('not-found', '프로젝트를 찾지 못했어요.')
        return changed(update(req.id, { pmId: null }), record('clear-pm', req.id, p.pmId, null))
      }
    }
  }
}
