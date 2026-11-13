import {
  EMPLOYEE_ACTORS,
  type EmployeeActor,
  type EmployeeCreateRequest,
  type EmployeeMoveRequest,
  type EmployeeRetireRequest,
  type EmployeeUpdateRequest
} from '../../shared/employee-change'
import { DECISION_ID, EMPLOYEE_ID } from '../repository/ids'
import { CONTROL_CHARS, isValidName } from '../org/parse-org-doc'
import { checkBody, checkDescription, checkModel, checkTools, type Checked } from './agent-file'
import { EMPLOYEE_TEMPLATES } from './templates'

const MAX_ROLE = 300
const MULTI = /[,;/、]/

function plain(raw: unknown, allowed: readonly string[]): Record<string, unknown> | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const proto = Object.getPrototypeOf(raw) as unknown
  if (proto !== Object.prototype && proto !== null) return null
  // 알 수 없는 키(`actor` 위조 등)는 조용히 무시하지 않고 거부한다.
  return Object.keys(raw).every((k) => allowed.includes(k))
    ? (raw as Record<string, unknown>)
    : null
}

const BAD = { ok: false, message: '요청 형식이 올바르지 않습니다.' } as const

const name = (v: unknown, what: string): Checked<string> =>
  typeof v === 'string' && isValidName(v) && !MULTI.test(v)
    ? { ok: true, value: v }
    : { ok: false, message: `${what} 형식이 올바르지 않습니다.` }

const role = (v: unknown): Checked<string> =>
  typeof v === 'string' && v === v.trim() && v.length <= MAX_ROLE && !CONTROL_CHARS.test(v)
    ? { ok: true, value: v }
    : { ok: false, message: '역할 설명 형식이 올바르지 않습니다.' }

export function parseId(v: unknown): Checked<string> {
  return typeof v === 'string' && EMPLOYEE_ID.test(v)
    ? { ok: true, value: v }
    : { ok: false, message: '직원 id 형식이 올바르지 않습니다.' }
}

/** 승인 카드 번호. 형식만 본다. 카드가 실제로 승인(done)됐는지는 서비스가 확인한다. */
function approval(v: unknown): Checked<string | undefined> {
  if (v === undefined) return { ok: true, value: undefined }
  return typeof v === 'string' && DECISION_ID.test(v)
    ? { ok: true, value: v }
    : { ok: false, message: '승인 카드 번호 형식이 올바르지 않습니다.' }
}

export function parseActor(v: unknown): EmployeeActor | null {
  return (EMPLOYEE_ACTORS as readonly unknown[]).includes(v) ? (v as EmployeeActor) : null
}

export function parseCreate(raw: unknown): Checked<EmployeeCreateRequest> {
  const o = plain(raw, ['templateId', 'id', 'department', 'reportsTo', 'title', 'role', 'approval'])
  if (!o) return BAD
  const template =
    typeof o.templateId === 'string' ? EMPLOYEE_TEMPLATES.find((t) => t.id === o.templateId) : null
  if (!template) return { ok: false, message: '알 수 없는 템플릿입니다.' }
  const id = parseId(o.id)
  const department = name(o.department, '부서 이름')
  const reportsTo = name(o.reportsTo, '보고 대상')
  const title =
    o.title === undefined ? { ok: true as const, value: undefined } : name(o.title, '직급')
  const r = o.role === undefined ? { ok: true as const, value: undefined } : role(o.role)
  const a = approval(o.approval)
  for (const c of [id, department, reportsTo, title, r, a]) if (!c.ok) return c
  if (!id.ok || !department.ok || !reportsTo.ok || !title.ok || !r.ok || !a.ok) return BAD
  return {
    ok: true,
    value: {
      templateId: template.id,
      id: id.value,
      department: department.value,
      reportsTo: reportsTo.value,
      title: title.value,
      role: r.value,
      approval: a.value
    }
  }
}

export function parseUpdate(raw: unknown): Checked<EmployeeUpdateRequest> {
  const o = plain(raw, ['id', 'description', 'model', 'tools', 'body', 'approval'])
  if (!o) return BAD
  const id = parseId(o.id)
  if (!id.ok) return id
  const a = approval(o.approval)
  if (!a.ok) return a
  const out: EmployeeUpdateRequest = { id: id.value, approval: a.value }
  if (o.description !== undefined) {
    const c = checkDescription(o.description)
    if (!c.ok) return c
    out.description = c.value
  }
  if (o.model !== undefined) {
    const c = checkModel(o.model)
    if (!c.ok) return c
    out.model = c.value as EmployeeUpdateRequest['model']
  }
  if (o.tools !== undefined) {
    const c = checkTools(o.tools)
    if (!c.ok) return c
    out.tools = c.value
  }
  if (o.body !== undefined) {
    const c = checkBody(o.body)
    if (!c.ok) return c
    out.body = c.value
  }
  if (
    out.description === undefined &&
    out.model === undefined &&
    out.tools === undefined &&
    out.body === undefined
  )
    return { ok: false, message: '바꿀 값이 없습니다.' }
  return { ok: true, value: out }
}

export function parseMove(raw: unknown): Checked<EmployeeMoveRequest> {
  const o = plain(raw, ['id', 'department', 'reportsTo', 'title', 'role', 'approval'])
  if (!o) return BAD
  const id = parseId(o.id)
  if (!id.ok) return id
  const a = approval(o.approval)
  if (!a.ok) return a
  const out: EmployeeMoveRequest = { id: id.value, approval: a.value }
  const fields: Array<['department' | 'reportsTo' | 'title', string]> = [
    ['department', '부서 이름'],
    ['reportsTo', '보고 대상'],
    ['title', '직급']
  ]
  for (const [key, what] of fields) {
    if (o[key] === undefined) continue
    const c = name(o[key], what)
    if (!c.ok) return c
    out[key] = c.value
  }
  if (o.role !== undefined) {
    const c = role(o.role)
    if (!c.ok) return c
    out.role = c.value
  }
  if (
    out.department === undefined &&
    out.reportsTo === undefined &&
    out.title === undefined &&
    out.role === undefined
  )
    return { ok: false, message: '바꿀 값이 없습니다.' }
  return { ok: true, value: out }
}

export function parseRetire(raw: unknown): Checked<EmployeeRetireRequest> {
  const o = plain(raw, ['id', 'approval'])
  if (!o) return BAD
  const id = parseId(o.id)
  if (!id.ok) return id
  const a = approval(o.approval)
  if (!a.ok) return a
  return { ok: true, value: { id: id.value, approval: a.value } }
}
