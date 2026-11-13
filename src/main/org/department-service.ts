import type {
  DepartmentAddRequest,
  DepartmentChangeAction,
  DepartmentChangeResult,
  DepartmentRemoveRequest,
  DepartmentRenameRequest
} from '../../shared/department'
import { validateDepartmentName, departmentKey } from '../../shared/department'
import type { EmployeeActor, SensitiveReason } from '../../shared/employee-change'
import type { OrgMember, OrgModel } from '../../shared/org'
import type { ApiResult, DomainErrorCode } from '../../shared/result'
import { BAD, approval, parseActor, parseId, plain } from '../employee/requests'
import type { Checked } from '../employee/agent-file'
import type { SafeFs } from '../repository/safe-fs'
import { ORG_FILE } from '../repository/parse-org'
import { removeDepartment, renameDepartment } from './department-store'
import { loadOrg, updateMember } from './org-store'

const PROTECTED_TITLES: ReadonlySet<string> = new Set(['COO', 'CEO'])
const SENSITIVE_IDS: ReadonlySet<string> = new Set(['cto', 'cfo', 'hr'])
const SENSITIVE_TITLES: ReadonlySet<string> = new Set(['CTO', 'CFO', '인사'])

export interface DepartmentServiceDeps {
  fs: SafeFs
  /** 결정 resolve, 직원 변경과 같은 쓰기 직렬화 큐. */
  exclusive: <T>(task: () => Promise<T>) => Promise<T>
  /** 승인된(done) 결정 카드인지. */
  isApproved: (cardId: string) => Promise<boolean>
  /** T-052 검증기가 앱 쓰기를 `ceo-ui`/`approved-proposal` 변경으로 판정하도록 호출자를 알린다. */
  runAs?: <T>(actor: EmployeeActor, task: () => Promise<T>) => Promise<T>
  now?: () => Date
}

const fail = (code: DomainErrorCode, message: string): ApiResult<never> => ({
  ok: false,
  code,
  message
})

const nameField = (v: unknown, what: string): Checked<string> =>
  typeof v === 'string' && v.length > 0 && v.length <= 60
    ? { ok: true, value: v }
    : { ok: false, message: `${what} 형식이 올바르지 않습니다.` }

function parseAdd(raw: unknown): Checked<DepartmentAddRequest> {
  const o = plain(raw, ['name', 'leadId', 'approval'])
  if (!o) return BAD
  const name = nameField(o.name, '부서 이름')
  if (!name.ok) return name
  const lead = parseId(o.leadId)
  if (!lead.ok) return lead
  const a = approval(o.approval)
  if (!a.ok) return a
  return { ok: true, value: { name: name.value, leadId: lead.value, approval: a.value } }
}

function parseRename(raw: unknown): Checked<DepartmentRenameRequest> {
  const o = plain(raw, ['from', 'to', 'approval'])
  if (!o) return BAD
  const from = nameField(o.from, '부서 이름')
  if (!from.ok) return from
  const to = nameField(o.to, '새 부서 이름')
  if (!to.ok) return to
  const a = approval(o.approval)
  if (!a.ok) return a
  return { ok: true, value: { from: from.value, to: to.value, approval: a.value } }
}

function parseRemove(raw: unknown): Checked<DepartmentRemoveRequest> {
  const o = plain(raw, ['name', 'approval'])
  if (!o) return BAD
  const name = nameField(o.name, '부서 이름')
  if (!name.ok) return name
  const a = approval(o.approval)
  if (!a.ok) return a
  return { ok: true, value: { name: name.value, approval: a.value } }
}

const isSensitive = (m: OrgMember): boolean =>
  (m.agentId !== null && SENSITIVE_IDS.has(m.agentId)) || SENSITIVE_TITLES.has(m.title)

/**
 * 부서 생성·이름 변경·삭제. UI 없이 호출할 수 있는 main 함수라 T-046(승인 후 적용)이 `actor: 'approved-proposal'`로 재사용한다.
 * 입력은 신뢰하지 않고 여기서 다시 검증한다 (IPC가 아니라 main 코드가 직접 불러도 같다).
 */
export class DepartmentService {
  constructor(private readonly deps: DepartmentServiceDeps) {}

  /** 먼저 채용한 직원(leadId)을 새 부서로 옮겨 부서를 만든다. 쓰기는 한 번이라 실패하면 파일은 그대로다. */
  add(raw: unknown, actor: EmployeeActor): Promise<ApiResult<DepartmentChangeResult>> {
    return this.run(actor, async () => {
      const req = parseAdd(raw)
      if (!req.ok) return fail('invalid-request', req.message)
      const { name, leadId, approval: card } = req.value
      const bad = validateDepartmentName(name)
      if (bad !== null) return fail('invalid-request', bad)
      const org = await this.load()
      if (!org.ok) return org
      if (org.value.departments.some((d) => departmentKey(d.name) === departmentKey(name)))
        return fail('conflict', '이미 있는 부서 이름입니다.')
      const lead = org.value.members.find((m) => m.kind === 'agent' && m.agentId === leadId)
      if (!lead) return fail('not-found', '조직도에 없는 직원입니다. 먼저 직원을 채용하세요.')
      if (PROTECTED_TITLES.has(lead.title))
        return fail('forbidden', '보호된 직원은 앱에서 바꿀 수 없습니다.')
      const reasons: SensitiveReason[] = isSensitive(lead) ? ['protected-role'] : []
      const gate = await this.gate(reasons, card)
      if (!gate.ok) return gate
      const updated = await updateMember(this.deps.fs, leadId, { department: name })
      if (!updated.ok) return fail(updated.code, updated.message)
      return this.done('add', name, null, [leadId], actor, card, reasons)
    })
  }

  /** 직원 행과 조직도 블록을 한 번의 쓰기로 바꾼다. COO·CEO가 속한 부서는 거부, cto·cfo·hr가 속하면 승인 카드가 필요하다. */
  rename(raw: unknown, actor: EmployeeActor): Promise<ApiResult<DepartmentChangeResult>> {
    return this.run(actor, async () => {
      const req = parseRename(raw)
      if (!req.ok) return fail('invalid-request', req.message)
      const { from, to, approval: card } = req.value
      const bad = validateDepartmentName(to)
      if (bad !== null) return fail('invalid-request', bad)
      const org = await this.load()
      if (!org.ok) return org
      const members = org.value.members.filter((m) => m.department === from)
      if (members.length === 0) return fail('not-found', '없는 부서입니다.')
      if (members.some((m) => PROTECTED_TITLES.has(m.title)))
        return fail('forbidden', '보호된 직원이 속한 부서는 앱에서 바꿀 수 없습니다.')
      const reasons: SensitiveReason[] = members.some(isSensitive) ? ['protected-role'] : []
      const gate = await this.gate(reasons, card)
      if (!gate.ok) return gate
      const done = await renameDepartment(this.deps.fs, from, to)
      if (!done.ok) return fail(done.code, done.message)
      const ids = members.flatMap((m) => (m.agentId === null ? [] : [m.agentId]))
      return this.done('rename', from, to, ids, actor, card, reasons)
    })
  }

  /** 직원이 0명인 부서만 지운다. 직원이 있으면 이동 또는 퇴사를 안내하는 `conflict`. */
  remove(raw: unknown, actor: EmployeeActor): Promise<ApiResult<DepartmentChangeResult>> {
    return this.run(actor, async () => {
      const req = parseRemove(raw)
      if (!req.ok) return fail('invalid-request', req.message)
      const { name, approval: card } = req.value
      const gate = await this.gate([], card)
      if (!gate.ok) return gate
      const done = await removeDepartment(this.deps.fs, name)
      if (!done.ok) return fail(done.code, done.message)
      return this.done('remove', name, null, [], actor, card, [])
    })
  }

  private run<T>(
    actorRaw: EmployeeActor,
    task: () => Promise<ApiResult<T>>
  ): Promise<ApiResult<T>> {
    const actor = parseActor(actorRaw)
    if (!actor) return Promise.resolve(fail('invalid-request', '호출자가 올바르지 않습니다.'))
    return this.deps.exclusive(async () => {
      try {
        return await (this.deps.runAs ? this.deps.runAs(actor, task) : task())
      } catch {
        return fail('internal', '요청을 처리하지 못했습니다.')
      }
    })
  }

  private async load(): Promise<ApiResult<OrgModel>> {
    const org = await loadOrg(this.deps.fs)
    if (org.members.length === 0) {
      const missing = org.issues.some((i) => i.code === 'missing-org')
      return fail(missing ? 'not-found' : 'internal', 'org.md를 읽을 수 없습니다.')
    }
    return { ok: true, value: org }
  }

  /** 민감 변경은 승인된 결정 카드가 필요하다. 번호를 줬다면 민감하지 않아도 확인한다. */
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

  private done(
    action: DepartmentChangeAction,
    department: string,
    newName: string | null,
    affectedEmployeeIds: string[],
    actor: EmployeeActor,
    card: string | undefined,
    reasons: SensitiveReason[]
  ): ApiResult<DepartmentChangeResult> {
    return {
      ok: true,
      value: {
        record: {
          action,
          department,
          newName,
          affectedEmployeeIds,
          actor,
          approval: card ?? null,
          sensitive: reasons.length > 0,
          sensitiveReasons: reasons,
          files: [ORG_FILE],
          at: (this.deps.now?.() ?? new Date()).toISOString()
        }
      }
    }
  }
}
