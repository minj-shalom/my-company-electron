import { realpath } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { OrgModel } from '../../shared/org'
import type { ApiResult, DomainErrorCode } from '../../shared/result'
import {
  MAX_PROJECT_PATH,
  isPmMember,
  isPmTitle,
  projectState,
  type ProjectChangeAction,
  type ProjectChangeRecord,
  type EmployeeProjectsResult,
  type ProjectChangeResult,
  type ProjectGit,
  type ProjectInfo,
  type ProjectList,
  type ProjectSelectFolderResult,
  type ProjectType
} from '../../shared/project'
import { loadOrg } from '../org/org-store'
import { splitFrontmatter } from '../repository/markdown'
import { AGENTS_DIR } from '../repository/parse-org'
import { FsGuardError, MAX_FILE_BYTES, type SafeFs } from '../repository/safe-fs'
import { gitToplevel, probeGit, spawnGit, type GitRunner } from './git-probe'
import {
  MAX_MEMBERS,
  MAX_PROJECTS,
  PROJECT_FILE,
  addProject,
  emptyProjectDoc,
  makeProjectId,
  parseProjectDoc,
  patchProject,
  preservedLines,
  serializeProjectDoc,
  viewProjectDoc,
  type DocProject,
  type ProjectDoc
} from './project-doc'
import {
  PATH_MESSAGES,
  checkProjectDir,
  foldPath,
  hasGitEntry,
  type PathContext
} from './project-path'
import {
  parseAdd,
  parseAssign,
  parseEmployeeProjects,
  parseId,
  parseRename,
  parseSetPm,
  parseSetType,
  type Parsed
} from './requests'
import { assignability, employeeProjects } from './assignments-store'

export { PROJECT_FILE }
const MAX_APPROVED_PATHS = 8
const GIT_CONCURRENCY = 4

/** 진행 중(in-progress) 티켓의 프로젝트 소속. `project`가 null이면 소속을 알 수 없는 티켓이다. */
export interface InProgressTicket {
  project: string | null
}
export interface InProgressSource {
  list(): Promise<{ tickets: InProgressTicket[]; unreadable: number }>
}

export interface ProjectServiceDeps {
  fs: SafeFs
  /** 결정 resolve, 티켓 이동, 직원 변경과 같은 쓰기 직렬화 큐 (FileCompanyRepository.runExclusive). */
  exclusive: <T>(task: () => Promise<T>) => Promise<T>
  inProgress: InProgressSource
  homeDir?: string
  git?: GitRunner
  now?: () => Date
}

const fail = (code: DomainErrorCode, message: string): ApiResult<never> => ({
  ok: false,
  code,
  message
})
const nameKey = (n: string): string => n.normalize('NFKC').toLowerCase()

class Stop extends Error {
  constructor(readonly result: ApiResult<never>) {
    super('stop')
  }
}
const stop = (code: DomainErrorCode, message: string): never => {
  throw new Stop(fail(code, message))
}

interface Change {
  next: ProjectDoc
  action: ProjectChangeAction
  projectId: string
  changedFields: string[]
  pmBefore: string | null
  pmAfter: string | null
  employeeId?: string
  /** 변경 없음. 파일을 쓰지 않는다. */
  noop?: boolean
  /** 쓰기가 끝난 뒤에 실행한다 (경로 승인 소비 등). */
  onCommitted?: () => void
}

/**
 * 회사 소유 프로젝트 목록(`company/project.md`)의 읽기·쓰기. 마크다운이 원본이며 디스크의 레포 폴더는 읽기 외에는 건드리지 않는다.
 * 폴더 경로는 main의 선택 다이얼로그가 돌려준 값만 받는다 (D-005 B, T-041 회사 선택과 같은 구조).
 */
export class ProjectService {
  private readonly git: GitRunner
  private readonly approved: string[] = []
  private pendingSelect: Promise<ProjectSelectFolderResult> | null = null

  constructor(private readonly deps: ProjectServiceDeps) {
    this.git = deps.git ?? spawnGit
  }

  private get ctx(): PathContext {
    return { companyRoot: this.deps.fs.root, homeDir: this.deps.homeDir }
  }

  // ---- 폴더 선택 ----

  /** 다이얼로그가 열려 있는 동안의 요청은 같은 결과를 공유한다. 고른 폴더의 실제 경로만 기억해 `add`에서 허용한다. */
  selectFolder(pick: () => Promise<string | null>): Promise<ProjectSelectFolderResult> {
    if (this.pendingSelect !== null) return this.pendingSelect
    const run = (async (): Promise<ProjectSelectFolderResult> => {
      const picked = await pick()
      if (picked === null) return null
      const real = await realpath(picked).catch(() => null)
      if (real === null) return null
      if (!this.approved.includes(real)) this.approved.push(real)
      while (this.approved.length > MAX_APPROVED_PATHS) this.approved.shift()
      return picked
    })().finally(() => {
      this.pendingSelect = null
    })
    this.pendingSelect = run
    return run
  }

  private async approvedReal(path: string): Promise<string | null> {
    const real = await realpath(path).catch(() => null)
    return real !== null && this.approved.includes(real) ? real : null
  }

  // ---- 조회 ----

  async list(): Promise<ApiResult<ProjectList>> {
    try {
      const { doc } = await this.read()
      const view = viewProjectDoc(doc)
      const org = await this.org()
      return {
        ok: true,
        value: {
          items: await this.describeAll(view.items, org),
          unreadable: view.issueLines.map((line) => ({ line, reason: 'invalid-block' as const })),
          format: view.format
        }
      }
    } catch (e) {
      return e instanceof Stop ? e.result : fail('internal', '프로젝트 목록을 읽지 못했습니다.')
    }
  }

  /** 방문 요약(T-043)용: "PM 필요" 상태인 프로젝트. 보관된 프로젝트는 제외한다. */
  async listPmRequired(): Promise<ApiResult<ProjectInfo[]>> {
    const r = await this.list()
    return r.ok ? { ok: true, value: r.value.items.filter((p) => p.state === 'pm-required') } : r
  }

  // ---- 변경 ----

  add(raw: unknown): Promise<ApiResult<ProjectChangeResult>> {
    return this.mutate(raw, parseAdd, async (input, doc, org) => {
      const real = await this.approvedReal(input.path)
      if (real === null)
        return stop(
          'path-not-allowed',
          '폴더 선택 화면에서 고른 폴더만 프로젝트로 추가할 수 있어요.'
        )
      const view = viewProjectDoc(doc)
      if (view.items.length + view.issueLines.length >= MAX_PROJECTS)
        stop('conflict', '프로젝트가 너무 많아 더 추가할 수 없어요.')
      const checked = await checkProjectDir(real, this.ctx)
      if (!checked.ok) return stop('invalid-request', PATH_MESSAGES[checked.reason])
      if (real !== real.trim() || real.length > MAX_PROJECT_PATH)
        stop('invalid-request', PATH_MESSAGES.invalid)
      if (view.items.some((p) => nameKey(p.name) === nameKey(input.name)))
        stop('conflict', '같은 이름의 프로젝트가 이미 있어요.')
      const taken = new Set(await this.registeredPaths(view.items))
      if (taken.has(foldPath(real)))
        stop('conflict', '이미 등록된 폴더예요. 보관된 프로젝트라면 복원하세요.')
      await this.requireGitFor(input.type, real)
      if (input.pm !== null) this.requirePm(org, input.pm)
      const project: DocProject = {
        id: makeProjectId(input.name, new Set(view.items.map((p) => p.id))),
        name: input.name,
        type: input.type,
        path: real,
        devCommand: input.devCommand,
        defaultBranch: input.defaultBranch,
        status: 'active',
        pmId: input.pm,
        memberIds: []
      }
      return {
        next: addProject(doc, project),
        action: 'add',
        projectId: project.id,
        changedFields: ['project'],
        pmBefore: null,
        pmAfter: input.pm,
        // 한 번 쓴 승인은 소비한다. 같은 폴더를 다시 추가하려면 다시 선택해야 한다.
        onCommitted: () => {
          const i = this.approved.indexOf(real)
          if (i >= 0) this.approved.splice(i, 1)
        }
      }
    })
  }

  rename(raw: unknown): Promise<ApiResult<ProjectChangeResult>> {
    return this.mutate(raw, parseRename, async ({ id, name }, doc) => {
      const view = viewProjectDoc(doc)
      const cur = this.find(view.items, id)
      if (view.items.some((p) => p.id !== id && nameKey(p.name) === nameKey(name)))
        stop('conflict', '같은 이름의 프로젝트가 이미 있어요.')
      return this.patched(doc, cur, 'rename', { name }, name !== cur.name ? ['name'] : [])
    })
  }

  archive(raw: unknown): Promise<ApiResult<ProjectChangeResult>> {
    return this.mutate(raw, parseId, async ({ id }, doc) => {
      const view = viewProjectDoc(doc)
      const cur = this.find(view.items, id)
      if (cur.status === 'archived') return this.patched(doc, cur, 'archive', {}, [])
      await this.requireNoActiveTickets(id, view.items)
      return this.patched(doc, cur, 'archive', { status: 'archived' }, ['status'])
    })
  }

  restore(raw: unknown): Promise<ApiResult<ProjectChangeResult>> {
    return this.mutate(raw, parseId, async ({ id }, doc) => {
      const cur = this.find(viewProjectDoc(doc).items, id)
      return this.patched(
        doc,
        cur,
        'restore',
        { status: 'active' },
        cur.status === 'archived' ? ['status'] : []
      )
    })
  }

  setType(raw: unknown): Promise<ApiResult<ProjectChangeResult>> {
    return this.mutate(raw, parseSetType, async ({ id, type }, doc) => {
      const cur = this.find(viewProjectDoc(doc).items, id)
      if (type === cur.type) return this.patched(doc, cur, 'set-type', {}, [])
      // content/other -> development만 git 검증을 다시 거친다. 반대 방향은 검증이 필요 없다.
      if (type === 'development') {
        const checked = await checkProjectDir(cur.path, this.ctx, true)
        if (!checked.ok) return stop('invalid-request', PATH_MESSAGES[checked.reason])
        await this.requireGitFor(type, checked.real)
      }
      // dev 명령과 기본 브랜치는 development에만 있는 필드다.
      const patch =
        type === 'development' ? { type } : { type, devCommand: null, defaultBranch: null }
      return this.patched(doc, cur, 'set-type', patch, ['type'])
    })
  }

  setPm(raw: unknown): Promise<ApiResult<ProjectChangeResult>> {
    return this.mutate(raw, parseSetPm, async ({ id, pm }, doc, org) => {
      const cur = this.find(viewProjectDoc(doc).items, id)
      this.requirePm(org, pm)
      return this.patched(doc, cur, 'set-pm', { pmId: pm }, pm !== cur.pmId ? ['pm'] : [])
    })
  }

  clearPm(raw: unknown): Promise<ApiResult<ProjectChangeResult>> {
    return this.mutate(raw, parseId, async ({ id }, doc) => {
      const cur = this.find(viewProjectDoc(doc).items, id)
      return this.patched(doc, cur, 'clear-pm', { pmId: null }, cur.pmId !== null ? ['pm'] : [])
    })
  }

  /** 일반 배정(`직원:` 줄). 멱등이다. 담당 PM은 `setPm`을 쓴다. 보관된 프로젝트에는 새로 배정하지 않는다. */
  assignEmployee(raw: unknown): Promise<ApiResult<ProjectChangeResult>> {
    return this.mutate(raw, parseAssign, async ({ id, employeeId }, doc, org) => {
      const cur = this.find(viewProjectDoc(doc).items, id)
      if (org === null) return stop('internal', '조직도를 읽지 못했어요.')
      const a = assignability(org, employeeId)
      if (a === 'protected') return stop('forbidden', 'CEO와 COO는 프로젝트에 배정할 수 없습니다.')
      if (a === 'unknown') return stop('not-found', '조직도에 없는 직원입니다.')
      if (cur.status === 'archived')
        return stop('conflict', '보관된 프로젝트에는 배정할 수 없어요. 먼저 복원하세요.')
      if (cur.pmId === employeeId)
        return stop('conflict', '이미 담당 PM입니다. PM은 일반 배정이 아니라 PM 지정으로 관리해요.')
      if (cur.memberIds.includes(employeeId))
        return { ...this.patched(doc, cur, 'assign-employee', {}, []), employeeId }
      if (cur.memberIds.length >= MAX_MEMBERS)
        return stop('conflict', '이 프로젝트에 배정할 수 있는 직원 수를 넘었어요.')
      return {
        ...this.patched(
          doc,
          cur,
          'assign-employee',
          { memberIds: [...cur.memberIds, employeeId] },
          ['members']
        ),
        employeeId
      }
    })
  }

  /** 일반 배정 해제. 멱등이다. 담당 PM은 거부한다 (PM 해제가 프로젝트를 "PM 필요"로 돌리므로 `clearPm`으로 따로 한다). 조직도에 없는 직원의 남은 줄도 지울 수 있다. */
  unassignEmployee(raw: unknown): Promise<ApiResult<ProjectChangeResult>> {
    return this.mutate(raw, parseAssign, async ({ id, employeeId }, doc) => {
      const cur = this.find(viewProjectDoc(doc).items, id)
      if (cur.pmId === employeeId)
        return stop('conflict', '담당 PM입니다. PM 해제 또는 교체로 바꿔 주세요.')
      const had = cur.memberIds.includes(employeeId)
      return {
        ...this.patched(
          doc,
          cur,
          'unassign-employee',
          { memberIds: cur.memberIds.filter((m) => m !== employeeId) },
          had ? ['members'] : []
        ),
        employeeId
      }
    })
  }

  /** 직원별 담당 프로젝트 (읽기 전용). 보관된 프로젝트는 `active: false`. */
  async employeeProjects(raw: unknown): Promise<ApiResult<EmployeeProjectsResult>> {
    const parsed = parseEmployeeProjects(raw)
    if (!parsed.ok) return fail('invalid-request', parsed.message)
    try {
      const { doc } = await this.read()
      return {
        ok: true,
        value: employeeProjects(viewProjectDoc(doc).items, await this.org(), parsed.value.id)
      }
    } catch (e) {
      return e instanceof Stop ? e.result : fail('internal', '프로젝트 배정을 읽지 못했습니다.')
    }
  }

  // ---- 내부: 검증 도우미 ----

  private find(items: DocProject[], id: string): DocProject {
    return items.find((p) => p.id === id) ?? stop('not-found', '프로젝트를 찾을 수 없습니다.')
  }

  private patched(
    doc: ProjectDoc,
    cur: DocProject,
    action: ProjectChangeAction,
    patch: Partial<Omit<DocProject, 'id'>>,
    changedFields: string[]
  ): Change {
    const pmAfter = 'pmId' in patch ? (patch.pmId ?? null) : cur.pmId
    if (changedFields.length === 0)
      return {
        next: doc,
        action,
        projectId: cur.id,
        changedFields,
        pmBefore: cur.pmId,
        pmAfter: cur.pmId,
        noop: true
      }
    const next = patchProject(doc, cur.id, patch)
    if (next === null) return stop('not-found', '프로젝트를 찾을 수 없습니다.')
    return { next, action, projectId: cur.id, changedFields, pmBefore: cur.pmId, pmAfter }
  }

  /** org.md의 PM 직급 직원인지. CEO/COO와 PM이 아닌 직원은 거부한다. */
  private requirePm(org: OrgModel | null, employeeId: string): void {
    const member = org?.members.find((m) => m.kind === 'agent' && m.agentId === employeeId)
    if (member === undefined) return stop('not-found', '조직도에 없는 직원입니다.')
    const title = member.title.trim().toLowerCase()
    if (title === 'ceo' || title === 'coo')
      return stop('forbidden', 'CEO와 COO는 PM으로 지정할 수 없습니다.')
    if (!member.fileExists)
      return stop('invalid-request', '직원 파일이 없어 PM으로 지정할 수 없습니다.')
    if (!isPmTitle(member.title))
      return stop('invalid-request', 'PM 직급의 직원만 지정할 수 있습니다.')
  }

  /** development는 폴더 자신이 독립 git 레포여야 한다. content/other는 검증하지 않는다. */
  private async requireGitFor(type: ProjectType, real: string): Promise<void> {
    if (type !== 'development') return
    const msg = 'development 프로젝트는 git 레포 폴더(.git이 있는 최상위 폴더)여야 해요.'
    if (!(await hasGitEntry(real))) return stop('invalid-request', msg)
    const top = await gitToplevel(this.git, real)
    // git을 실행하지 못하면(미설치, 시간 초과) `.git` 존재만으로 판단한다. 실행됐는데 최상위가 다르면 하위 폴더이므로 거부한다.
    if (!top.ok) return
    const topReal = top.top === null ? null : await realpath(top.top).catch(() => null)
    if (topReal === null || foldPath(topReal) !== foldPath(real)) stop('invalid-request', msg)
  }

  /**
   * 진행 중 티켓이 있으면 보관을 거부한다. 티켓에 프로젝트 필드가 아직 없으므로(T-042) 소속을 판정할 수 없는 티켓은
   * 모든 프로젝트에 속한 것으로 본다 (보수적). `- **프로젝트:** id`가 있으면 그 프로젝트에만 속한다.
   */
  private async requireNoActiveTickets(id: string, items: DocProject[]): Promise<void> {
    let src
    try {
      src = await this.deps.inProgress.list()
    } catch {
      return stop('internal', '진행 중인 티켓을 확인하지 못해 보관하지 않았어요.')
    }
    const known = new Set(items.map((p) => p.id))
    const blocking = src.tickets.filter(
      (t) => t.project === null || t.project === id || !known.has(t.project)
    )
    if (src.unreadable > 0 || blocking.length > 0)
      stop(
        'conflict',
        '진행 중인 티켓이 있어 보관할 수 없어요. 티켓을 마무리하거나 옮긴 뒤 다시 시도하세요.'
      )
  }

  // ---- 내부: 읽기/쓰기 ----

  private async read(): Promise<{ doc: ProjectDoc; text: string | null }> {
    let text: string | null = null
    try {
      text = await this.deps.fs.readText(PROJECT_FILE)
    } catch (e) {
      if (!(e instanceof FsGuardError && e.kind === 'missing'))
        return stop('internal', 'project.md를 읽을 수 없습니다.')
    }
    return { text, doc: text === null ? emptyProjectDoc() : parseProjectDoc(text) }
  }

  private async org(): Promise<OrgModel | null> {
    try {
      const org = await loadOrg(this.deps.fs)
      return org.members.length > 0 ? org : null
    } catch {
      return null
    }
  }

  private async mutate<I>(
    raw: unknown,
    parse: (raw: unknown) => Parsed<I>,
    build: (input: I, doc: ProjectDoc, org: OrgModel | null) => Promise<Change>
  ): Promise<ApiResult<ProjectChangeResult>> {
    const parsed = parse(raw)
    if (!parsed.ok) return fail('invalid-request', parsed.message)
    return this.deps.exclusive(async () => {
      try {
        const { text, doc } = await this.read()
        const org = await this.org()
        const change = await build(parsed.value, doc, org)
        if (!change.noop) await this.commit(text, doc, change)
        change.onCommitted?.()
        const view = viewProjectDoc(change.noop ? doc : change.next)
        const written = view.items.find((p) => p.id === change.projectId)
        const [info] = written ? await this.describeAll([written], org) : []
        const record: ProjectChangeRecord = {
          action: change.action,
          projectId: change.projectId,
          actor: 'ceo-ui',
          approval: null,
          pmBefore: change.pmBefore,
          pmAfter: change.pmAfter,
          changedFields: change.changedFields,
          ...(change.employeeId === undefined ? {} : { employeeId: change.employeeId }),
          at: (this.deps.now?.() ?? new Date()).toISOString()
        }
        return info === undefined
          ? fail('internal', '요청을 처리하지 못했습니다.')
          : { ok: true as const, value: { record, project: info, stateAfter: info.state } }
      } catch (e) {
        if (e instanceof Stop) return e.result
        return fail('internal', '요청을 처리하지 못했습니다.')
      }
    })
  }

  /** 직렬화 -> 재파싱 검증 -> 쓰기 직전 재읽기(conflict) -> 쓰기 -> 읽어서 확인(실패 시 롤백). */
  private async commit(original: string | null, before: ProjectDoc, change: Change): Promise<void> {
    const fs = this.deps.fs
    const out = serializeProjectDoc(change.next)
    if (Buffer.byteLength(out, 'utf8') > MAX_FILE_BYTES)
      stop('invalid-request', 'project.md가 너무 커져서 저장하지 않았어요.')
    // 이름·경로에 구조를 위조하는 값이 섞였거나 직렬화가 어긋났다면 쓰기 전에 막는다.
    const again = parseProjectDoc(out)
    const expected = viewProjectDoc(change.next)
    const actual = viewProjectDoc(again)
    const beforeView = viewProjectDoc(before)
    if (
      again.legacy !== null ||
      JSON.stringify(actual.items) !== JSON.stringify(expected.items) ||
      actual.issueLines.length !== beforeView.issueLines.length ||
      JSON.stringify(preservedLines(again)) !== JSON.stringify(preservedLines(change.next))
    )
      stop('invalid-request', '변경 내용을 올바르게 저장할 수 없어 취소했습니다.')

    // 쓰기 직전에 원본이 그대로인지 다시 확인한다 (CLI 에이전트 등의 동시 수정 대비).
    let current: string | null = null
    try {
      current = await fs.readText(PROJECT_FILE)
    } catch (e) {
      if (!(e instanceof FsGuardError && e.kind === 'missing'))
        stop('internal', 'project.md를 읽을 수 없습니다.')
    }
    if (current !== original)
      stop('conflict', 'project.md가 동시에 수정되고 있습니다. 다시 시도하세요.')

    try {
      // 파일이 없던 경우는 no-clobber로 만든다 (그 사이 생긴 파일을 덮어쓰지 않는다).
      await fs.writeText(PROJECT_FILE, out, original !== null)
    } catch (e) {
      if (e instanceof FsGuardError && e.kind === 'exists')
        return stop('conflict', 'project.md가 동시에 수정되고 있습니다. 다시 시도하세요.')
      return stop('internal', 'project.md를 쓰지 못했습니다.')
    }
    const ok = await fs.readText(PROJECT_FILE).then(
      (t) => t === out,
      () => false
    )
    if (!ok) {
      try {
        if (original === null) await fs.remove(PROJECT_FILE)
        else await fs.writeText(PROJECT_FILE, original)
      } catch {
        return stop(
          'internal',
          '쓴 내용을 확인하지 못했고 되돌리지도 못했습니다. project.md를 확인하세요.'
        )
      }
      stop('internal', '쓴 내용을 확인하지 못해 되돌렸습니다.')
    }
  }

  // ---- 내부: 표시 정보 ----

  /** 등록된 프로젝트의 실제 경로(접은 형태). 사라진 폴더는 문자열 경로로 비교한다. */
  private async registeredPaths(items: DocProject[]): Promise<string[]> {
    return Promise.all(
      items.map(async (p) => {
        const abs = resolve(this.deps.fs.root, p.path)
        return foldPath(await realpath(abs).catch(() => abs))
      })
    )
  }

  private async describeAll(items: DocProject[], org: OrgModel | null): Promise<ProjectInfo[]> {
    const names = new Map<string, string>()
    const out: ProjectInfo[] = new Array<ProjectInfo>(items.length)
    let next = 0
    const worker = async (): Promise<void> => {
      for (let i = next++; i < items.length; i = next++) {
        out[i] = await this.describe(items[i], org, names)
      }
    }
    await Promise.all(Array.from({ length: Math.min(GIT_CONCURRENCY, items.length) }, worker))
    return out
  }

  private async describe(
    p: DocProject,
    org: OrgModel | null,
    names: Map<string, string>
  ): Promise<ProjectInfo> {
    const state = projectState(p, org)
    // 담당 PM이 현재 조직도에서 유효하면 보관된 프로젝트에도 표시한다. 깨진 참조는 오류가 아니라 pm null이다.
    const pm =
      p.pmId !== null && isPmMember(org, p.pmId)
        ? { id: p.pmId, name: await this.employeeName(p.pmId, names) }
        : null
    return {
      id: p.id,
      name: p.name,
      type: p.type,
      path: resolve(this.deps.fs.root, p.path),
      devCommand: p.devCommand,
      defaultBranch: p.defaultBranch,
      status: p.status,
      pmId: p.pmId,
      memberIds: p.memberIds,
      pm,
      state,
      git: await this.gitInfo(p)
    }
  }

  private async employeeName(id: string, cache: Map<string, string>): Promise<string> {
    const hit = cache.get(id)
    if (hit !== undefined) return hit
    let name = id
    try {
      const { data } = splitFrontmatter(await this.deps.fs.readText(`${AGENTS_DIR}/${id}.md`))
      if (typeof data.name === 'string' && data.name.trim() !== '' && data.name.length <= 100)
        name = data.name.trim()
    } catch {
      // 이름을 못 읽어도 id로 표시한다.
    }
    cache.set(id, name)
    return name
  }

  private async gitInfo(p: DocProject): Promise<ProjectGit> {
    // 저장된 경로는 신뢰하지 않는다. 회사 폴더와 겹치거나 홈·루트면 조회하지 않는다.
    const checked = await checkProjectDir(p.path, this.ctx, true)
    if (!checked.ok) return { status: 'missing' }
    // 폴더 안에 `.git`이 없으면 상위 레포를 조회하지 않도록 건너뛴다 (content/other는 정상).
    if (!(await hasGitEntry(checked.real))) return { status: 'not-repo' }
    return probeGit(this.git, checked.real)
  }
}
