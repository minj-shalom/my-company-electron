import type { WindowApi } from '../../../shared/api'
import {
  checkProjectName,
  isPmTitle,
  type ProjectInfo,
  type ProjectList,
  type ProjectType
} from '../../../shared/project'
import type { DomainErrorCode } from '../../../shared/result'
import type { BadgeTone } from '../ui/Badge'

export const TYPE_LABELS: Record<ProjectType, string> = {
  development: '개발',
  content: '콘텐츠',
  other: '기타'
}

export interface PmCandidate {
  id: string
  name: string
}

export type ProjectsLoad =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; list: ProjectList; pms: PmCandidate[] }

const LOAD_ERROR = '프로젝트 목록을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.'
const NOT_IMPLEMENTED = '이 버전의 앱은 아직 프로젝트 관리를 지원하지 않아요.'

export async function loadProjects(
  api: Pick<WindowApi, 'listProjects' | 'getOrg'>
): Promise<ProjectsLoad> {
  try {
    const [list, org] = await Promise.all([api.listProjects(), api.getOrg().catch(() => null)])
    if (!list.ok)
      return {
        kind: 'error',
        message: list.code === 'not-implemented' ? NOT_IMPLEMENTED : LOAD_ERROR
      }
    // 조직도를 못 읽어도 목록은 보여 준다. PM 후보만 비어 '인사팀에 PM 채용' 쪽으로 안내된다.
    const pms: PmCandidate[] = []
    if (org?.ok) {
      for (const m of org.value.org.members) {
        if (m.kind !== 'agent' || !m.fileExists || m.agentId === null || !isPmTitle(m.title))
          continue
        const detail = org.value.agents.find((a) => a.id === m.agentId)
        pms.push({ id: m.agentId, name: detail?.name.trim() || m.title })
      }
    }
    return { kind: 'ready', list: list.value, pms }
  } catch {
    return { kind: 'error', message: LOAD_ERROR }
  }
}

const FALLBACK: Partial<Record<DomainErrorCode, string>> = {
  'no-company': '열린 회사가 없어요. 회사를 다시 열어 주세요.',
  'path-not-allowed': '폴더 선택 창에서 고른 폴더만 쓸 수 있어요. 다시 선택해 주세요.',
  'not-found': '프로젝트를 찾지 못했어요. 목록을 새로 불러와 주세요.',
  forbidden: '이 직원은 PM으로 지정할 수 없어요.',
  'approval-required': '이 변경은 앱에서 바로 할 수 없어요. COO에게 요청해 주세요.',
  'not-implemented': '이 버전의 앱은 아직 이 기능을 지원하지 않아요.'
}
const GENERIC = '처리하지 못했어요. 바뀐 것은 없어요. 잠시 뒤 다시 시도해 주세요.'

/**
 * 규칙 위반(경로, 이름 중복, 진행 중 티켓)은 main의 고정 문구가 사유를 담고 있어 그대로 보여 준다.
 * 그 밖의 코드는 내부 표현이 섞일 수 있어 코드별 문장만 쓴다.
 */
export function projectErrorText(code: unknown, message: unknown): string {
  if (
    (code === 'conflict' || code === 'invalid-request') &&
    typeof message === 'string' &&
    message.trim() !== '' &&
    message.length <= 200
  )
    return message
  return (
    (typeof code === 'string' && Object.hasOwn(FALLBACK, code)
      ? FALLBACK[code as DomainErrorCode]
      : undefined) ?? GENERIC
  )
}

export const ARCHIVE_BLOCKED_HINT =
  '소속이 지정되지 않은 진행 중 티켓은 모든 프로젝트에 속한 것으로 보고 함께 막아요. 티켓을 마무리하거나 프로젝트를 지정한 뒤 다시 시도해 주세요.'

export type ActionResult =
  { ok: true; message: string } | { ok: false; message: string; detail?: string }

const fail = (code: unknown, message: unknown, detail?: string): ActionResult => ({
  ok: false,
  message: projectErrorText(code, message),
  ...(detail ? { detail } : {})
})

async function guarded(run: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await run()
  } catch {
    return { ok: false, message: GENERIC }
  }
}

export const renameProject = (
  api: Pick<WindowApi, 'renameProject'>,
  id: string,
  name: string
): Promise<ActionResult> =>
  guarded(async () => {
    const r = await api.renameProject({ id, name })
    return r.ok
      ? { ok: true, message: `이름을 "${r.value.project.name}"(으)로 바꿨어요.` }
      : fail(r.code, r.message)
  })

export const archiveProject = (
  api: Pick<WindowApi, 'archiveProject'>,
  id: string
): Promise<ActionResult> =>
  guarded(async () => {
    const r = await api.archiveProject({ id })
    if (r.ok)
      return {
        ok: true,
        message: `"${r.value.project.name}" 프로젝트를 보관했어요. 폴더는 그대로 있어요.`
      }
    return fail(r.code, r.message, r.code === 'conflict' ? ARCHIVE_BLOCKED_HINT : undefined)
  })

export const restoreProject = (
  api: Pick<WindowApi, 'restoreProject'>,
  id: string
): Promise<ActionResult> =>
  guarded(async () => {
    const r = await api.restoreProject({ id })
    return r.ok
      ? { ok: true, message: `"${r.value.project.name}" 프로젝트를 복원했어요.` }
      : fail(r.code, r.message)
  })

export const clearPm = (
  api: Pick<WindowApi, 'clearProjectPm'>,
  id: string
): Promise<ActionResult> =>
  guarded(async () => {
    const r = await api.clearProjectPm({ id })
    return r.ok
      ? {
          ok: true,
          message: `"${r.value.project.name}"의 담당 PM을 해제했어요. 이제 "PM 필요" 상태예요.`
        }
      : fail(r.code, r.message)
  })

export type PmChoice = { kind: 'existing'; id: string } | { kind: 'hire' } | { kind: 'later' }

/** PM 후보가 있으면 가장 적합한 첫 후보, 없으면 인사팀 채용이 기본이다 (CEO 확정). */
export function defaultPmChoice(pms: readonly PmCandidate[]): PmChoice {
  return pms.length > 0 ? { kind: 'existing', id: pms[0].id } : { kind: 'hire' }
}

/** 맡은 활성 프로젝트가 적은 PM을 앞에 둔다 (같으면 이름순). 첫 후보에 '추천' 표시를 붙인다. */
export function rankPms(
  pms: readonly PmCandidate[],
  projects: readonly ProjectInfo[]
): PmCandidate[] {
  const load = (id: string): number =>
    projects.filter((p) => p.status === 'active' && p.pmId === id).length
  return [...pms].sort((a, b) => load(a.id) - load(b.id) || a.name.localeCompare(b.name, 'ko'))
}

/**
 * PM 지정. 'hire'는 PM을 바로 채용(T-035)한 뒤 지정한다. 채용 후 지정이 실패해도 채용은 되돌리지 않으므로
 * 어디까지 됐는지 문구로 알린다.
 */
async function applyPm(
  api: Pick<WindowApi, 'hirePm' | 'setProjectPm'>,
  projectId: string,
  choice: PmChoice
): Promise<ActionResult | null> {
  if (choice.kind === 'later') return null
  let pmId: string
  if (choice.kind === 'existing') pmId = choice.id
  else {
    const hired = await api.hirePm()
    if (!hired.ok)
      return {
        ok: false,
        message:
          hired.code === 'conflict'
            ? '이미 PM이 있어요. 목록을 새로 불러온 뒤 기존 PM을 골라 주세요.'
            : projectErrorText(hired.code, hired.message)
      }
    pmId = hired.value.employeeId
  }
  const set = await api.setProjectPm({ id: projectId, pm: pmId })
  if (set.ok) return null
  return {
    ok: false,
    message:
      choice.kind === 'hire'
        ? `PM은 채용했지만 프로젝트에 지정하지 못했어요. ${projectErrorText(set.code, set.message)}`
        : projectErrorText(set.code, set.message)
  }
}

export const assignPm = (
  api: Pick<WindowApi, 'hirePm' | 'setProjectPm'>,
  project: Pick<ProjectInfo, 'id' | 'name'>,
  choice: PmChoice
): Promise<ActionResult> =>
  guarded(async () => {
    const failed = await applyPm(api, project.id, choice)
    return failed ?? { ok: true, message: `"${project.name}"의 담당 PM을 지정했어요.` }
  })

export interface AddInput {
  path: string
  name: string
  type: ProjectType
  pm: PmChoice
}

/**
 * 프로젝트 추가 + 담당 PM. 추가가 실패하면 아무것도 바뀌지 않는다(error). 추가는 됐는데 PM 단계가 실패하면
 * 프로젝트는 "PM 필요"로 남으므로 partial로 알린다.
 */
export type AddOutcome =
  | { kind: 'done'; message: string }
  | { kind: 'partial'; message: string }
  | { kind: 'error'; message: string }

export async function addProjectFlow(
  api: Pick<WindowApi, 'addProject' | 'hirePm' | 'setProjectPm'>,
  input: AddInput
): Promise<AddOutcome> {
  try {
    const added = await api.addProject({
      path: input.path,
      name: input.name,
      type: input.type,
      ...(input.pm.kind === 'existing' ? { pm: input.pm.id } : {})
    })
    if (!added.ok) return { kind: 'error', message: projectErrorText(added.code, added.message) }
    const project = added.value.project
    if (input.pm.kind === 'hire') {
      const failed = await applyPm(api, project.id, input.pm)
      if (failed && !failed.ok)
        return {
          kind: 'partial',
          message: `"${project.name}" 프로젝트는 추가했지만 PM을 정하지 못했어요. ${failed.message} 목록에서 "담당 PM 지정"을 눌러 다시 시도해 주세요.`
        }
    }
    const tail = input.pm.kind === 'later' ? ' 담당 PM이 없어서 "PM 필요" 상태예요.' : ''
    return { kind: 'done', message: `"${project.name}" 프로젝트를 추가했어요.${tail}` }
  } catch {
    return { kind: 'error', message: GENERIC }
  }
}

/** 폴더 이름을 이름 입력의 기본값으로 쓴다. 이름 규칙에 맞지 않으면 비워 둔다. */
export function suggestName(path: string): string {
  const base = path.split(/[\\/]/).filter(Boolean).pop() ?? ''
  return checkProjectName(base) === null ? base : ''
}

export interface AddFormErrors {
  name?: string
}

export function validateAddForm(f: { name: string }): AddFormErrors {
  const errors: AddFormErrors = {}
  const nameError = checkProjectName(f.name)
  if (nameError) errors.name = nameError
  return errors
}

export interface GitView {
  /** 표시할 작업 버전(브랜치) 이름. 모르면 null. */
  branch: string | null
  branchText: string
  dirtyText: string
  tone: BadgeTone
}

/** git 조회 결과 표시. unavailable이어도 `.git/HEAD`로 읽은 브랜치가 있으면 보여 주고 변경 여부만 '알 수 없음'으로 둔다. */
const unknownVersion = (type: ProjectType): string =>
  type === 'development' ? '브랜치를 알 수 없어요' : '작업 버전을 알 수 없어요'

export function gitView(p: Pick<ProjectInfo, 'git' | 'type'>): GitView {
  const g = p.git
  switch (g.status) {
    case 'ok':
      return {
        branch: g.branch,
        branchText: g.branch ?? unknownVersion(p.type),
        dirtyText: g.dirty ? '변경 있음' : '변경 없음',
        tone: g.dirty ? 'warn' : 'good'
      }
    case 'unavailable':
      return {
        branch: g.branch ?? null,
        branchText: g.branch ? g.branch : unknownVersion(p.type),
        dirtyText: '변경 여부 알 수 없음',
        tone: 'neutral'
      }
    case 'not-repo':
      return p.type === 'development'
        ? { branch: null, branchText: 'git 레포가 아니에요', dirtyText: '확인 필요', tone: 'warn' }
        : {
            branch: null,
            branchText: '작업 버전 관리를 쓰지 않아요 (정상)',
            dirtyText: '해당 없음',
            tone: 'neutral'
          }
    case 'missing':
      return {
        branch: null,
        branchText: '폴더를 찾을 수 없어요',
        dirtyText: '확인 필요',
        tone: 'bad'
      }
  }
}

export function stateBadge(p: Pick<ProjectInfo, 'state'>): { label: string; tone: BadgeTone } {
  switch (p.state) {
    case 'ready':
      return { label: '운영 중', tone: 'good' }
    case 'pm-required':
      return { label: 'PM 필요', tone: 'warn' }
    case 'archived':
      return { label: '보관됨', tone: 'neutral' }
  }
}

export const pmRequiredCount = (items: readonly ProjectInfo[]): number =>
  items.filter((p) => p.state === 'pm-required').length

/** 현재 프로젝트 선택이 더는 유효하지 않으면(삭제·보관) 전체(null)로 되돌린다. */
export function resolveCurrent(
  selected: string | null,
  items: readonly ProjectInfo[]
): string | null {
  return selected !== null && items.some((p) => p.id === selected && p.status === 'active')
    ? selected
    : null
}

export const LEGACY_NOTE =
  '이전 형식의 프로젝트 설정을 읽었어요. 앱에서 처음 저장하면 새 형식으로 바뀌고, 바뀌기 전 내용은 되돌릴 수 있어요.'

/** 읽지 못한 프로젝트 설정 항목의 위치. 파일 이름·형식 대신 쉬운 말로 보여 준다. */
export const unreadableLabel = (line: number): string => `프로젝트 설정 ${line}번째 항목`

/** 폴더 선택 창. 취소하면 null. 프로젝트 경로는 이 창이 돌려준 값만 main이 받는다. */
export async function pickFolder(
  api: Pick<WindowApi, 'selectProjectFolder'>
): Promise<{ path: string } | { error: string } | null> {
  try {
    const r = await api.selectProjectFolder()
    if (!r.ok) return { error: projectErrorText(r.code, r.message) }
    return r.value === null ? null : { path: r.value }
  } catch {
    return { error: GENERIC }
  }
}
