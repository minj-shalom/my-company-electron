import {
  EMPLOYEE_MODELS,
  MAX_EMPLOYEE_BODY_BYTES,
  MAX_EMPLOYEE_DESCRIPTION,
  MAX_EMPLOYEE_TOOLS,
  type EmployeeCreateRequest,
  type EmployeeModel,
  type EmployeeMoveRequest,
  type EmployeeTemplateInfo,
  type EmployeeUpdateRequest
} from '../../../shared/employee-change'
import type { OrgAgentDetail, OrgMember, OrgSnapshot } from '../../../shared/org'
import type { DomainErrorCode } from '../../../shared/result'
import { normalizeTitle } from '../hire/hire-model'

/** 직원 id 규칙. main(employee-service)과 같은 패턴이며 최종 판정은 main 응답을 따른다. */
export const EMPLOYEE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,49}$/
export const MAX_TITLE_LENGTH = 40
const TOOL_PATTERN = /^[A-Za-z][A-Za-z0-9_:*().-]{0,59}$/

export type EmployeeAction = 'create' | 'update' | 'move' | 'retire'

/** main의 message는 노출하지 않고 코드별 고정 문장만 쓴다. */
export function errorText(code: DomainErrorCode, action: EmployeeAction): string {
  switch (code) {
    case 'invalid-request':
      return action === 'move'
        ? '이 조합으로는 옮길 수 없어요. 보고 라인이 순환하거나 부서장은 옮길 수 없어요.'
        : '입력한 내용을 확인해 주세요. 허용되지 않는 값이 있어요.'
    case 'conflict':
      return action === 'create'
        ? '같은 이름이나 직급의 직원이 이미 있어요. 다른 이름으로 시도해 주세요.'
        : '다른 곳에서 먼저 바뀌었거나 이 변경을 할 수 없는 상태예요. 다시 불러온 뒤 시도해 주세요.'
    case 'forbidden':
      return '보호된 직원(COO, CEO)은 바꿀 수 없어요.'
    case 'approval-required':
      return '이 변경은 CEO 승인이 필요해요. 결재함의 결정 카드에서 승인을 받은 뒤 다시 시도해 주세요.'
    case 'not-found':
      return '직원을 찾을 수 없어요. 조직도를 다시 불러와 주세요.'
    case 'no-company':
      return '열린 회사가 없어요.'
    case 'not-implemented':
      return '이 버전의 앱은 아직 이 기능을 지원하지 않아요.'
    default:
      return '처리하지 못했어요. 잠시 뒤 다시 시도해 주세요.'
  }
}

/** 충돌처럼 "다시 불러오기"가 해결책인 오류인지. */
export const isStaleCode = (code: DomainErrorCode): boolean =>
  code === 'conflict' || code === 'not-found'

// ---- 채용 ----

export interface HireFormValues {
  templateId: string
  id: string
  title: string
  department: string
  reportsTo: string
}

export interface HireFormErrors {
  id?: string
  title?: string
  department?: string
  reportsTo?: string
}

export function existingAgentIds(snapshot: OrgSnapshot): Set<string> {
  return new Set([
    ...snapshot.agents.map((a) => a.id),
    ...snapshot.org.members.flatMap((m) => (m.agentId ? [m.agentId] : []))
  ])
}

export function departmentNames(snapshot: OrgSnapshot): string[] {
  return snapshot.org.departments.map((d) => d.name)
}

/** 템플릿 목록: PM을 맨 앞(바로가기)에 두고 나머지는 받은 순서. */
export function orderTemplates(list: readonly EmployeeTemplateInfo[]): EmployeeTemplateInfo[] {
  return [...list].sort((a, b) => Number(b.id === 'pm') - Number(a.id === 'pm'))
}

/** 입력 중 안내용 검증. 통과해도 main이 최종 판정한다. */
export function validateHire(values: HireFormValues, snapshot: OrgSnapshot): HireFormErrors {
  const errors: HireFormErrors = {}
  if (!values.id) errors.id = '이름(영문 id)을 입력해 주세요.'
  else if (!EMPLOYEE_ID_PATTERN.test(values.id))
    errors.id = '영문 소문자·숫자·하이픈만, 첫 글자는 소문자나 숫자, 50자 이내로 써 주세요.'
  else if (existingAgentIds(snapshot).has(values.id)) errors.id = '이미 같은 이름의 직원이 있어요.'

  const title = values.title.trim()
  if (!title) errors.title = '직급을 입력해 주세요.'
  else if (title.length > MAX_TITLE_LENGTH)
    errors.title = `직급은 ${MAX_TITLE_LENGTH}자 이내로 써 주세요.`
  else if (snapshot.org.members.some((m) => normalizeTitle(m.title) === normalizeTitle(title)))
    errors.title = '이미 같은 직급이 있어요. 다른 직급 이름을 써 주세요.'

  if (!departmentNames(snapshot).includes(values.department))
    errors.department = '기존 부서 중에서 골라 주세요.'
  if (!snapshot.org.members.some((m) => m.title === values.reportsTo))
    errors.reportsTo = '보고 대상을 골라 주세요.'
  return errors
}

export const hasErrors = (e: object): boolean => Object.keys(e).length > 0

/** 템플릿을 고르면 채울 기본값. 부서는 추천 부서가 있으면 그것, 없으면 첫 부서. */
export function defaultsFor(t: EmployeeTemplateInfo, snapshot: OrgSnapshot): HireFormValues {
  const depts = departmentNames(snapshot)
  const reports =
    snapshot.org.members.find((m) => m.title === 'COO') ??
    snapshot.org.members.find((m) => m.kind === 'agent')
  return {
    templateId: t.id,
    id: existingAgentIds(snapshot).has(t.id) ? '' : t.id,
    title: t.title,
    department: depts.includes(t.department) ? t.department : (depts[0] ?? ''),
    reportsTo: (reports ?? snapshot.org.members[0])?.title ?? ''
  }
}

export function buildCreateRequest(
  values: HireFormValues,
  template: EmployeeTemplateInfo
): EmployeeCreateRequest {
  const title = values.title.trim()
  return {
    templateId: values.templateId,
    id: values.id,
    department: values.department,
    reportsTo: values.reportsTo,
    ...(title !== template.title ? { title } : {})
  }
}

// ---- 편집 ----

export interface EditValues {
  description: string
  /** '' = 바꾸지 않음. */
  model: EmployeeModel | ''
  tools: string[]
  /** '' = 바꾸지 않음 (현재 프롬프트는 org:get이 주지 않으므로 교체 입력만 받는다). */
  body: string
}

export function initialEdit(agent: OrgAgentDetail | undefined): EditValues {
  const model = EMPLOYEE_MODELS.find((m) => m === agent?.model) ?? ''
  return {
    description: agent?.description ?? '',
    model,
    tools: [...(agent?.tools ?? [])],
    body: ''
  }
}

export function isEditDirty(initial: EditValues, current: EditValues): boolean {
  return (
    initial.description !== current.description ||
    initial.model !== current.model ||
    initial.body !== current.body ||
    initial.tools.join('\n') !== current.tools.join('\n')
  )
}

/** 쉼표·공백으로 나눈 도구 입력. 중복과 빈 값은 걸러낸다. */
export function parseToolInput(text: string): string[] {
  return [...new Set(text.split(/[\s,]+/).filter(Boolean))]
}

export interface EditErrors {
  description?: string
  tools?: string
  body?: string
}

const byteLength = (s: string): number => new TextEncoder().encode(s).length

export function validateEdit(values: EditValues): EditErrors {
  const e: EditErrors = {}
  const d = values.description.trim()
  if (!d) e.description = '설명을 입력해 주세요.'
  else if (values.description.length > MAX_EMPLOYEE_DESCRIPTION)
    e.description = `설명은 ${MAX_EMPLOYEE_DESCRIPTION}자 이내로 써 주세요.`
  if (values.tools.length > MAX_EMPLOYEE_TOOLS) e.tools = `도구는 ${MAX_EMPLOYEE_TOOLS}개까지예요.`
  else if (values.tools.some((t) => !TOOL_PATTERN.test(t)))
    e.tools = '도구 이름에 쓸 수 없는 글자가 있어요.'
  if (byteLength(values.body) > MAX_EMPLOYEE_BODY_BYTES) e.body = '프롬프트가 너무 길어요.'
  return e
}

/** 도구를 비우거나 Bash를 새로 넣으면 main이 확대로 보고 승인을 요구할 수 있다. */
export function mayNeedApproval(initial: EditValues, current: EditValues): boolean {
  const cleared = initial.tools.length > 0 && current.tools.length === 0
  const bashAdded = current.tools.includes('Bash') && !initial.tools.includes('Bash')
  return cleared || bashAdded
}

/** 바뀐 필드만 담는다. 바뀐 것이 없으면 null. */
export function buildUpdateRequest(
  id: string,
  initial: EditValues,
  current: EditValues
): EmployeeUpdateRequest | null {
  const req: EmployeeUpdateRequest = { id }
  let changed = false
  if (current.description.trim() !== initial.description.trim()) {
    req.description = current.description.trim()
    changed = true
  }
  if (current.model && current.model !== initial.model) {
    req.model = current.model
    changed = true
  }
  if (initial.tools.join('\n') !== current.tools.join('\n')) {
    req.tools = current.tools
    changed = true
  }
  if (current.body.trim()) {
    req.body = current.body
    changed = true
  }
  return changed ? req : null
}

// ---- 이동·퇴사 ----

/** 직급 기준 하위 직원(보고 라인 아래 전부). */
export function descendants(snapshot: OrgSnapshot, title: string): Set<string> {
  const out = new Set<string>()
  const queue = [title]
  while (queue.length > 0) {
    const t = queue.pop() as string
    for (const m of snapshot.org.members)
      if (m.reportsTo === t && !out.has(m.title)) {
        out.add(m.title)
        queue.push(m.title)
      }
  }
  return out
}

export function reportTargets(snapshot: OrgSnapshot, member: OrgMember): OrgMember[] {
  const banned = descendants(snapshot, member.title)
  return snapshot.org.members.filter((m) => m.title !== member.title && !banned.has(m.title))
}

/** 부서의 첫 직원이 부서장이다. 혼자인 부서는 옮겨도 부서가 사라질 뿐이라 부서장으로 막지 않는다. */
export function isDepartmentLead(snapshot: OrgSnapshot, member: OrgMember): boolean {
  const dept = snapshot.org.departments.find((d) => d.name === member.department)
  return !!dept && dept.members.length > 1 && dept.members[0] === member.title
}

export interface MoveValues {
  department: string
  reportsTo: string
}

export function validateMove(
  snapshot: OrgSnapshot,
  member: OrgMember,
  values: MoveValues
): string | null {
  if (!departmentNames(snapshot).includes(values.department)) return '기존 부서 중에서 골라 주세요.'
  if (values.reportsTo === member.title) return '자기 자신에게 보고할 수 없어요.'
  if (descendants(snapshot, member.title).has(values.reportsTo))
    return '보고 라인이 순환해요. 이 직원 아래에 있는 직원에게는 보고할 수 없어요.'
  if (!snapshot.org.members.some((m) => m.title === values.reportsTo))
    return '보고 대상을 골라 주세요.'
  if (values.department !== member.department && isDepartmentLead(snapshot, member))
    return '부서장은 다른 부서로 옮길 수 없어요. 먼저 부서장을 바꿔 주세요.'
  return null
}

export function buildMoveRequest(
  id: string,
  member: OrgMember,
  values: MoveValues
): EmployeeMoveRequest | null {
  const req: EmployeeMoveRequest = { id }
  if (values.department !== member.department) req.department = values.department
  if (values.reportsTo !== member.reportsTo) req.reportsTo = values.reportsTo
  return req.department === undefined && req.reportsTo === undefined ? null : req
}

/** 퇴사 불가 이유. 가능하면 null. `pmProjects`는 이 직원이 담당 PM인 활성 프로젝트 이름. */
export function retireBlockReason(
  snapshot: OrgSnapshot,
  member: OrgMember,
  pmProjects: readonly string[]
): string | null {
  if (member.kind !== 'agent' || !member.agentId)
    return 'AI 직원 파일이 있는 직원만 퇴사 처리할 수 있어요.'
  if (pmProjects.length > 0) return '담당 PM이라 먼저 대체 PM을 지정하세요.'
  if (snapshot.org.members.some((m) => m.reportsTo === member.title))
    return '이 직원에게 보고하는 직원이 있어요. 먼저 그 직원의 보고 대상을 바꿔 주세요.'
  if (isDepartmentLead(snapshot, member))
    return '부서장이에요. 먼저 다른 직원을 부서장으로 바꿔 주세요.'
  return null
}

/** COO·CTO·CFO·hr 변경은 승인이 필요하다 (main 판정). 화면에서는 미리 알리기만 한다. */
export function protectedNote(member: OrgMember): string | null {
  if (member.agentId === 'hr' || member.title === '인사') return '인사팀 변경은 승인이 필요해요.'
  if (['cto', 'cfo'].includes(member.agentId ?? '')) return '이 직원의 변경은 승인이 필요해요.'
  return null
}
