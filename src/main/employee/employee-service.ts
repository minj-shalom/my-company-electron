import type {
  ChangeRecord,
  EmployeeActor,
  EmployeeAssignment,
  EmployeeChangeAction,
  EmployeeChangeResult,
  EmployeeWarning,
  SensitiveReason
} from '../../shared/employee-change'
import type { OrgMember, OrgModel } from '../../shared/org'
import type { ApiResult, DomainErrorCode } from '../../shared/result'
import {
  addMember,
  loadOrg,
  removeMember,
  updateMember,
  type OrgMemberPatch
} from '../org/org-store'
import { splitFrontmatter } from '../repository/markdown'
import { AGENTS_DIR, ORG_FILE } from '../repository/parse-org'
import { MAX_FILE_BYTES, FsGuardError, type SafeFs } from '../repository/safe-fs'
import type { OrgMemberInput } from '../../shared/org'
import { buildAgentFile, isToolsExpansion, readTools, verifyAgentFile } from './agent-file'
import { parseActor, parseCreate, parseMove, parseRetire, parseUpdate } from './requests'
import { EMPLOYEE_TEMPLATES } from './templates'

export const ARCHIVE_DIR = 'company/archive/employees'
const MAX_ARCHIVE_SUFFIX = 99

/** 파일 변경 승인 없이는 바꿀 수 없는 직원. COO와 CEO 행은 승인이 있어도 앱이 바꾸지 않는다. */
const PROTECTED_TITLES: ReadonlySet<string> = new Set(['COO', 'CEO'])
const SENSITIVE_IDS: ReadonlySet<string> = new Set(['cto', 'cfo', 'hr'])
const SENSITIVE_TITLES: ReadonlySet<string> = new Set(['CTO', 'CFO', '인사'])
const PM_TITLE = 'PM'

/** 프로젝트 배정 조회. T-045가 실제 구현으로 교체하며, 그 전에는 항상 빈 목록이다. */
export interface AssignmentSource {
  listAssignments(employeeId: string): Promise<EmployeeAssignment[]>
}
export const NO_ASSIGNMENTS: AssignmentSource = { listAssignments: async () => [] }

export interface OrgOps {
  addMember: typeof addMember
  updateMember: typeof updateMember
  removeMember: typeof removeMember
}

export interface EmployeeServiceDeps {
  fs: SafeFs
  /** 결정 resolve, 티켓 이동과 같은 쓰기 직렬화 큐 (FileCompanyRepository.runExclusive). */
  exclusive: <T>(task: () => Promise<T>) => Promise<T>
  /**
   * 승인 카드가 결정 완료(done) 상태이고 결정이 기록(`chosen`)돼 있는지.
   * 한계: 카드가 어떤 직원·동작을 승인했는지는 묶지 않아 같은 카드를 다른 변경에 재사용할 수 있다 (T-046에서 대상 id·action 바인딩 예정).
   */
  isApproved: (cardId: string) => Promise<boolean>
  assignments?: AssignmentSource
  /** T-052 검증기가 앱 자신의 쓰기를 `ceo-ui`/`approved-proposal` 변경으로 판정하도록, 쓰는 동안 호출자를 알린다. */
  runAs?: <T>(actor: EmployeeActor, task: () => Promise<T>) => Promise<T>
  now?: () => Date
  /** 실패 주입 테스트용. */
  orgOps?: Partial<OrgOps>
}

const fail = (code: DomainErrorCode, message: string): ApiResult<never> => ({
  ok: false,
  code,
  message
})
const agentPath = (id: string): string => `${AGENTS_DIR}/${id}.md`

function mapOrgFailure(r: Extract<ApiResult<OrgModel>, { ok: false }>): ApiResult<never> {
  // org-store 문구는 고정 문구라 그대로 쓴다 (내부 경로 없음).
  return fail(r.code, r.message)
}

export class EmployeeService {
  private readonly ops: OrgOps
  private readonly assignments: AssignmentSource

  constructor(private readonly deps: EmployeeServiceDeps) {
    this.ops = { addMember, updateMember, removeMember, ...deps.orgOps }
    this.assignments = deps.assignments ?? NO_ASSIGNMENTS
  }

  // 모든 입력(raw)은 신뢰하지 않고 여기서 다시 검증한다. IPC가 아니라 main 코드가 직접 불러도 같다.
  create(raw: unknown, actor: EmployeeActor): Promise<ApiResult<EmployeeChangeResult>> {
    return this.run(actor, async () => {
      const req = parseCreate(raw)
      if (!req.ok) return fail('invalid-request', req.message)
      const r = req.value
      const template = EMPLOYEE_TEMPLATES.find((t) => t.id === r.templateId)
      if (!template) return fail('invalid-request', '알 수 없는 템플릿입니다.')
      const title = r.title ?? template.title
      const role = r.role ?? template.role

      const org = await this.loadOrgModel()
      if (!org.ok) return org
      const members = org.value.members
      if (members.some((m) => m.agentId === r.id || m.title === title))
        return fail('conflict', '이미 있는 직급 또는 직원입니다.')
      if (!members.some((m) => m.title === r.reportsTo))
        return fail('invalid-request', '보고 대상이 표에 없습니다.')
      if (await this.deps.fs.exists(agentPath(r.id)))
        return fail('conflict', '이미 있는 직급 또는 직원입니다.')

      const reasons: SensitiveReason[] = []
      if (
        SENSITIVE_IDS.has(r.id) ||
        SENSITIVE_IDS.has(template.id) ||
        SENSITIVE_TITLES.has(title) ||
        PROTECTED_TITLES.has(title)
      )
        reasons.push('protected-role')
      const gate = await this.gate(reasons, r.approval)
      if (!gate.ok) return gate

      const body = `${template.body.trim()}\n`
      const text = buildAgentFile(
        {
          name: r.id,
          description: template.description,
          tools: template.tools.join(', '),
          model: template.model
        },
        body
      )
      const expected = {
        name: r.id,
        description: template.description,
        model: template.model,
        tools: template.tools,
        body
      }
      if (Buffer.byteLength(text, 'utf8') > MAX_FILE_BYTES || !verifyAgentFile(text, expected))
        return fail('invalid-request', '직원 파일을 올바르게 만들 수 없어 취소했습니다.')

      // 파일을 먼저 만들고(no-clobber) 표에 행을 추가한다. 행 추가가 실패하면 만든 파일을 되돌린다.
      try {
        await this.deps.fs.writeText(agentPath(r.id), text, false)
      } catch (e) {
        if (e instanceof FsGuardError && e.kind === 'exists')
          return fail('conflict', '이미 있는 직급 또는 직원입니다.')
        return fail('internal', '직원 파일을 쓰지 못했습니다.')
      }
      const rollback = async (): Promise<void> => {
        await this.removeIfUnchanged(agentPath(r.id), text)
      }
      try {
        const written = await this.deps.fs.readText(agentPath(r.id))
        if (written !== text || !verifyAgentFile(written, expected)) {
          await rollback()
          return fail('internal', '쓴 직원 파일을 확인하지 못해 되돌렸습니다.')
        }
        const input: OrgMemberInput = {
          title,
          agentId: r.id,
          department: r.department,
          reportsTo: r.reportsTo,
          role
        }
        const added = await this.ops.addMember(this.deps.fs, input)
        if (!added.ok) {
          await rollback()
          return mapOrgFailure(added)
        }
      } catch {
        await rollback()
        return fail('internal', '직원을 추가하지 못해 되돌렸습니다.')
      }
      return this.done(
        'create',
        r.id,
        actor,
        r.approval,
        reasons,
        ['file', 'row'],
        [agentPath(r.id), ORG_FILE]
      )
    })
  }

  update(raw: unknown, actor: EmployeeActor): Promise<ApiResult<EmployeeChangeResult>> {
    return this.run(actor, async () => {
      const req = parseUpdate(raw)
      if (!req.ok) return fail('invalid-request', req.message)
      const r = req.value
      const target = await this.findAgent(r.id)
      if (!target.ok) return target
      const { member } = target.value
      const path = agentPath(r.id)

      let original: string
      try {
        original = await this.deps.fs.readText(path)
      } catch (e) {
        if (e instanceof FsGuardError && e.kind === 'missing')
          return fail('not-found', '직원 파일을 찾을 수 없습니다.')
        return fail('invalid-request', '직원 파일을 읽을 수 없습니다.')
      }
      // 깨진 frontmatter는 덮어쓰지 않는다 (본문 유실 방지).
      let existing: ReturnType<typeof splitFrontmatter>
      try {
        existing = splitFrontmatter(original)
      } catch {
        return fail('invalid-request', '직원 파일의 frontmatter가 깨져 있어 수정하지 않습니다.')
      }
      if (typeof existing.data.description !== 'string' || !original.startsWith('---'))
        return fail('invalid-request', '직원 파일의 frontmatter가 깨져 있어 수정하지 않습니다.')

      const data: Record<string, unknown> = { ...existing.data }
      const oldTools = 'tools' in data ? readTools(data.tools) : null
      const changed: string[] = []
      if (r.description !== undefined && r.description !== data.description) {
        data.description = r.description
        changed.push('description')
      }
      if (r.model !== undefined && r.model !== data.model) {
        data.model = r.model
        changed.push('model')
      }
      let newTools = oldTools
      if (r.tools !== undefined) {
        if (JSON.stringify(r.tools) !== JSON.stringify(oldTools ?? [])) changed.push('tools')
        if (r.tools.length === 0) delete data.tools
        else data.tools = r.tools.join(', ')
        newTools = r.tools
      }
      // 기존 본문은 건드리지 않고 그대로 옮긴다 (앞쪽 빈 줄만 정리).
      let keepFrom = 0
      while (existing.body[keepFrom] === '\n' || existing.body[keepFrom] === '\r') keepFrom++
      const oldBody = existing.body.slice(keepFrom)
      const body = r.body ?? oldBody
      if (r.body !== undefined && r.body !== oldBody) changed.push('body')

      const reasons: SensitiveReason[] = []
      if (this.isSensitiveMember(member)) reasons.push('protected-role')
      if (r.tools !== undefined && isToolsExpansion(oldTools, newTools ?? []))
        reasons.push('tools-expansion')
      const gate = await this.gate(reasons, r.approval)
      if (!gate.ok) return gate

      const files: string[] = []
      if (changed.length > 0) {
        const text = buildAgentFile(data, body)
        const expected = {
          name: typeof data.name === 'string' ? data.name : undefined,
          description: String(data.description),
          model: typeof data.model === 'string' ? data.model : undefined,
          tools: 'tools' in data ? readTools(data.tools) : [],
          body
        }
        if (Buffer.byteLength(text, 'utf8') > MAX_FILE_BYTES || !verifyAgentFile(text, expected))
          return fail('invalid-request', '수정한 직원 파일이 올바르게 읽히지 않아 취소했습니다.')
        // 쓰기 직전에 원본이 그대로인지 다시 확인한다 (CLI 에이전트 등의 동시 수정 대비).
        if ((await this.deps.fs.readText(path)) !== original)
          return fail('conflict', '직원 파일이 동시에 수정되고 있습니다. 다시 시도하세요.')
        await this.deps.fs.writeText(path, text)
        try {
          const written = await this.deps.fs.readText(path)
          if (written !== text || !verifyAgentFile(written, expected)) throw new Error('verify')
        } catch {
          await this.deps.fs.writeText(path, original).catch(() => undefined)
          return fail('internal', '쓴 직원 파일을 확인하지 못해 되돌렸습니다.')
        }
        files.push(path)
      }
      return this.done('update', r.id, actor, r.approval, reasons, changed, files)
    })
  }

  move(raw: unknown, actor: EmployeeActor): Promise<ApiResult<EmployeeChangeResult>> {
    return this.run(actor, async () => {
      const req = parseMove(raw)
      if (!req.ok) return fail('invalid-request', req.message)
      const r = req.value
      const target = await this.findAgent(r.id)
      if (!target.ok) return target
      const { member, org } = target.value

      const newTitle = r.title ?? member.title
      if (r.reportsTo !== undefined) {
        const boss = org.members.find((m) => m.title === r.reportsTo)
        if (!boss) return fail('invalid-request', '보고 대상이 표에 없습니다.')
        if (r.reportsTo === member.title || r.reportsTo === newTitle)
          return fail('invalid-request', '자기 자신에게 보고할 수 없습니다.')
        // 새 보고 대상에서 위로 올라가다 이 직원을 만나면 순환이다.
        const byTitle = new Map(org.members.map((m) => [m.title, m]))
        const seen = new Set<string>()
        for (let cur: OrgMember | undefined = boss; cur; cur = byTitle.get(cur.reportsTo ?? '')) {
          if (cur.title === member.title)
            return fail('invalid-request', '보고 라인이 순환하게 되어 거부했습니다.')
          if (seen.has(cur.title)) break
          seen.add(cur.title)
        }
      }

      const patch: OrgMemberPatch = {}
      const changed: string[] = []
      const set = (
        key: 'title' | 'department' | 'reportsTo' | 'role',
        cur: string | null
      ): void => {
        const next = r[key]
        if (next !== undefined && next !== cur) {
          patch[key] = next
          changed.push(key)
        }
      }
      set('title', member.title)
      set('department', member.department)
      set('reportsTo', member.reportsTo)
      set('role', member.role)

      // 보호 직급(COO, CEO)으로 바꾸는 것은 승인이 있어도 거부하고, CTO/CFO/인사 직급으로 바꾸는 것은 민감 변경이다.
      if (patch.title !== undefined && PROTECTED_TITLES.has(patch.title))
        return fail('forbidden', '보호된 직급으로는 바꿀 수 없습니다.')
      const reasons: SensitiveReason[] = []
      if (
        this.isSensitiveMember(member) ||
        (patch.title !== undefined && SENSITIVE_TITLES.has(patch.title))
      )
        reasons.push('protected-role')
      const gate = await this.gate(reasons, r.approval)
      if (!gate.ok) return gate

      const warnings: EmployeeWarning[] = []
      if (patch.title !== undefined && member.title === PM_TITLE)
        warnings.push({
          code: 'pm-required',
          message: 'PM 직급이 바뀌어 이 직원이 PM인 프로젝트는 "PM 필요" 상태가 됩니다.'
        })
      if (changed.length === 0) return this.done('move', r.id, actor, r.approval, reasons, [], [])

      const updated = await this.ops.updateMember(this.deps.fs, r.id, patch)
      if (!updated.ok) return mapOrgFailure(updated)
      return this.done('move', r.id, actor, r.approval, reasons, changed, [ORG_FILE], warnings)
    })
  }

  retire(raw: unknown, actor: EmployeeActor): Promise<ApiResult<EmployeeChangeResult>> {
    return this.run(actor, async () => {
      const req = parseRetire(raw)
      if (!req.ok) return fail('invalid-request', req.message)
      const r = req.value
      const target = await this.findAgent(r.id)
      if (!target.ok) return target
      const { member, org } = target.value

      const reporters = org.members.filter((m) => m !== member && m.reportsTo === member.title)
      if (reporters.some((m) => member.department !== null && m.department === member.department))
        return fail('conflict', '부서장은 퇴사시킬 수 없습니다. 먼저 부서장을 바꾸세요.')
      if (reporters.length > 0)
        return fail('conflict', '다른 직원의 보고 대상입니다. 먼저 보고 대상을 옮기세요.')
      let assigned: EmployeeAssignment[]
      try {
        assigned = await this.assignments.listAssignments(r.id)
      } catch {
        return fail('internal', '프로젝트 배정을 확인하지 못했습니다.')
      }
      if (assigned.some((a) => a.role === 'pm'))
        return fail('conflict', '담당 PM입니다. 먼저 대체 PM을 지정하거나 해제하세요.')
      if (assigned.length > 0)
        return fail('conflict', '프로젝트에 배정돼 있습니다. 먼저 배정을 해제하세요.')

      const reasons: SensitiveReason[] = ['retire']
      if (this.isSensitiveMember(member)) reasons.push('protected-role')
      const gate = await this.gate(reasons, r.approval)
      if (!gate.ok) return gate

      const fs = this.deps.fs
      const path = agentPath(r.id)
      let original: string | null = null
      try {
        original = await fs.readText(path)
      } catch (e) {
        // 파일이 이미 없으면 행만 정리한다.
        if (!(e instanceof FsGuardError && e.kind === 'missing'))
          return fail('invalid-request', '직원 파일을 읽을 수 없습니다.')
      }

      let archived: string | null = null
      if (original !== null) {
        archived = await this.archive(r.id, original)
        if (archived === null)
          return fail('internal', '보관 폴더에 직원 파일을 보관하지 못했습니다.')
        // 보관 뒤 원본이 바뀌었으면 (동시 수정) 지우지 않고 되돌린다.
        const still = await fs.readText(path).catch(() => null)
        if (still !== original) {
          await this.removeIfUnchanged(archived, original)
          return fail('conflict', '직원 파일이 동시에 수정되고 있습니다. 다시 시도하세요.')
        }
        try {
          await fs.remove(path)
        } catch {
          await this.removeIfUnchanged(archived, original)
          return fail('internal', '직원 파일을 보관 폴더로 옮기지 못했습니다.')
        }
      }

      let removed: ApiResult<OrgModel>
      try {
        removed = await this.ops.removeMember(fs, r.id)
      } catch {
        removed = fail('internal', 'org.md를 갱신하지 못했습니다.')
      }
      if (!removed.ok) {
        // 행을 못 지웠으면 원본을 되살리고 보관 사본을 지운다. 되살리지 못하면 보관 사본을 남겨 내용을 잃지 않는다.
        if (original !== null && archived !== null) {
          try {
            await fs.writeText(path, original, false)
            await this.removeIfUnchanged(archived, original)
          } catch {
            return fail(
              'internal',
              '직원 파일을 되살리지 못했습니다. 보관 폴더의 사본을 확인하세요.'
            )
          }
        }
        return mapOrgFailure(removed)
      }
      const files = archived !== null ? [path, archived, ORG_FILE] : [ORG_FILE]
      return this.done('retire', r.id, actor, r.approval, reasons, ['file', 'row'], files)
    })
  }

  // ---- 내부 ----

  /** 호출자 검증, 직렬화 큐, 호출 컨텍스트(T-052)를 한 곳에서 처리한다. 예외는 고정 문구로 바꾼다. */
  private run(
    actorRaw: EmployeeActor,
    task: () => Promise<ApiResult<EmployeeChangeResult>>
  ): Promise<ApiResult<EmployeeChangeResult>> {
    const actor = parseActor(actorRaw)
    if (!actor) return Promise.resolve(fail('invalid-request', '호출자가 올바르지 않습니다.'))
    const scoped = (): Promise<ApiResult<EmployeeChangeResult>> =>
      this.deps.runAs ? this.deps.runAs(actor, task) : task()
    return this.deps.exclusive(async () => {
      try {
        return await scoped()
      } catch {
        return fail('internal', '요청을 처리하지 못했습니다.')
      }
    })
  }

  private isSensitiveMember(m: OrgMember): boolean {
    return (m.agentId !== null && SENSITIVE_IDS.has(m.agentId)) || SENSITIVE_TITLES.has(m.title)
  }

  /** 민감 변경은 승인된(done) 결정 카드 번호가 있어야 한다. 번호를 줬다면 민감하지 않아도 확인한다. */
  private async gate(
    reasons: SensitiveReason[],
    cardId: string | undefined
  ): Promise<ApiResult<null>> {
    if (reasons.length === 0 && cardId === undefined) return { ok: true, value: null }
    if (cardId === undefined)
      return fail('approval-required', '민감한 변경이라 승인된 결정 카드 번호가 필요합니다.')
    const approved = await this.deps.isApproved(cardId).catch(() => false)
    return approved
      ? { ok: true, value: null }
      : fail('approval-required', '승인된 결정 카드를 찾을 수 없습니다.')
  }

  private async loadOrgModel(): Promise<ApiResult<OrgModel>> {
    const org = await loadOrg(this.deps.fs)
    if (org.members.length === 0) {
      const missing = org.issues.some((i) => i.code === 'missing-org')
      return fail(missing ? 'not-found' : 'internal', 'org.md를 읽을 수 없습니다.')
    }
    return { ok: true, value: org }
  }

  /** 조직도에서 직원(agent)을 찾고 보호 대상(COO, CEO)이면 거부한다. */
  private async findAgent(id: string): Promise<ApiResult<{ member: OrgMember; org: OrgModel }>> {
    const org = await this.loadOrgModel()
    if (!org.ok) return org
    const member = org.value.members.find((m) => m.kind === 'agent' && m.agentId === id)
    if (!member) return fail('not-found', '조직도에 없는 직원입니다.')
    if (PROTECTED_TITLES.has(member.title))
      return fail('forbidden', '보호된 직원은 앱에서 바꿀 수 없습니다.')
    return { ok: true, value: { member, org: org.value } }
  }

  /** 보관 폴더에 덮어쓰지 않고 쓴다. 같은 이름이 있으면 `-2`, `-3`... 을 붙인다. 쓴 상대 경로를 돌려준다. */
  private async archive(id: string, text: string): Promise<string | null> {
    for (let n = 1; n <= MAX_ARCHIVE_SUFFIX; n++) {
      const rel = `${ARCHIVE_DIR}/${n === 1 ? id : `${id}-${n}`}.md`
      try {
        await this.deps.fs.writeText(rel, text, false)
      } catch (e) {
        if (e instanceof FsGuardError && e.kind === 'exists') continue
        return null
      }
      try {
        if ((await this.deps.fs.readText(rel)) === text) return rel
      } catch {
        // 확인하지 못한 사본은 지우고 실패로 본다.
      }
      await this.removeIfUnchanged(rel, text)
      return null
    }
    return null
  }

  /** 내용이 우리가 쓴 그대로일 때만 지운다 (그 사이 다른 쪽이 고친 파일을 지우지 않는다). */
  private async removeIfUnchanged(rel: string, expected: string): Promise<void> {
    try {
      if ((await this.deps.fs.readText(rel)) === expected) await this.deps.fs.remove(rel)
    } catch {
      // 이미 없거나 읽을 수 없으면 지울 것이 없다.
    }
  }

  private done(
    action: EmployeeChangeAction,
    employeeId: string,
    actor: EmployeeActor,
    approval: string | undefined,
    reasons: SensitiveReason[],
    changedFields: string[],
    files: string[],
    warnings: EmployeeWarning[] = []
  ): ApiResult<EmployeeChangeResult> {
    const record: ChangeRecord = {
      action,
      employeeId,
      actor,
      approval: approval ?? null,
      sensitive: reasons.length > 0,
      sensitiveReasons: reasons,
      changedFields,
      files,
      at: (this.deps.now?.() ?? new Date()).toISOString()
    }
    return { ok: true, value: { record, warnings } }
  }
}
