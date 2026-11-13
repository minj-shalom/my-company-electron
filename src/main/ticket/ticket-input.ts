import {
  MAX_TICKET_CRITERIA,
  MAX_TICKET_CRITERION,
  MAX_TICKET_DEPARTMENT,
  MAX_TICKET_GOAL,
  MAX_TICKET_BODY_CHARS,
  MAX_TICKET_TITLE
} from '../../shared/ticket'
import { PROJECT_ID, hasForbiddenChar } from '../../shared/project'
import { EMPLOYEE_ID, TICKET_ID } from '../repository/ids'

/** 검증을 통과한 본문 필드. 제어 문자는 제거되어 있고 줄 구조를 바꿀 수 있는 입력은 남지 않는다. */
export interface TicketFields {
  title: string
  goal: string
  criteria: string[]
  /** undefined는 "요청에 없음"(생성에서 기본값 계산), null은 "담당 없음". */
  assignee: string | null | undefined
  department: string | null
  projectId: string | null
}

export type CreateInput = TicketFields
export interface UpdateInput extends TicketFields {
  id: string
  expectedBody: string
  assignee: string | null
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string }
const bad = (message: string): Parsed<never> => ({ ok: false, message })

/** 줄 구조를 위조하거나 보이지 않는 문자를 지운다. `keepNewline`이면 `\n`(과 `\r\n`)만 줄바꿈으로 남기고, 그 외 줄바꿈과 탭은 공백이 된다 (단어가 붙지 않게). */
export function stripControl(v: string, keepNewline: boolean): string {
  const src = keepNewline ? v.replace(/\r\n/g, '\n') : v
  let out = ''
  for (const ch of src) {
    if (keepNewline && ch === '\n') out += ch
    else if (ch === '\t' || ch === '\n' || ch === '\r') out += ' '
    else if (!hasForbiddenChar(ch)) out += ch
  }
  return out
}

function oneLine(v: unknown, max: number): string | null {
  // 입력이 비정상적으로 길면 정리 전에 거른다 (뒤 단계가 긴 문자열에서 오래 걸리지 않게).
  if (typeof v !== 'string' || v.length > max * 4) return null
  const s = stripControl(v, false).replace(/ {2,}/g, ' ').trim()
  return s.length >= 1 && [...s].length <= max ? s : null
}

const FENCE = /^[ \t]*(```|~~~)/
const HEADING = /^[ \t]*#/

function parseGoal(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > MAX_TICKET_GOAL * 4) return null
  const s = stripControl(v, true)
    .split('\n')
    .map((l) => l.trimEnd())
    .join('\n')
    .trim()
  if ([...s].length > MAX_TICKET_GOAL) return null
  // 목표 안의 제목·코드 펜스는 문서 구조(섹션, 상태 줄 탐색)를 바꾸므로 받지 않는다.
  if (s.split('\n').some((l) => HEADING.test(l) || FENCE.test(l))) return null
  return s
}

function parseCommon(
  r: Record<string, unknown>,
  requireProjectKeys: boolean
): Parsed<TicketFields> {
  const title = oneLine(r.title, MAX_TICKET_TITLE)
  if (title === null) return bad(`제목은 1~${MAX_TICKET_TITLE}자의 한 줄이어야 합니다.`)
  const goal = parseGoal(r.goal)
  if (goal === null)
    return bad(
      `목표는 ${MAX_TICKET_GOAL}자 이하여야 하고 #나 코드 블록으로 시작하는 줄을 쓸 수 없습니다.`
    )
  if (!Array.isArray(r.criteria) || r.criteria.length > MAX_TICKET_CRITERIA * 2)
    return bad('완료 조건 목록이 올바르지 않습니다.')
  const criteria: string[] = []
  for (const c of r.criteria) {
    const one = oneLine(c, MAX_TICKET_CRITERION)
    // 빈 항목은 버리지 않고 거부한다: 사용자가 입력한 줄이 조용히 사라지지 않게 한다.
    if (one === null)
      return bad(`완료 조건 항목은 1~${MAX_TICKET_CRITERION}자의 한 줄이어야 합니다.`)
    criteria.push(one)
  }
  if (criteria.length < 1) return bad('완료 조건을 1개 이상 입력해 주세요.')
  if (criteria.length > MAX_TICKET_CRITERIA)
    return bad(`완료 조건은 ${MAX_TICKET_CRITERIA}개까지 입력할 수 있습니다.`)

  let assignee: string | null | undefined
  if (r.assignee === undefined) assignee = undefined
  else if (r.assignee === null) assignee = null
  else if (typeof r.assignee === 'string' && EMPLOYEE_ID.test(r.assignee)) assignee = r.assignee
  else return bad('담당 직원 값이 올바르지 않습니다.')
  // 편집은 값을 전부 명시해야 한다 (생략을 "그대로 둠"으로 해석하면 의도와 다른 변경이 생긴다).
  if (requireProjectKeys && assignee === undefined) return bad('담당 값이 필요합니다.')

  let department: string | null
  if (r.department === undefined && !requireProjectKeys) department = null
  else if (r.department === null) department = null
  else {
    const d = oneLine(r.department, MAX_TICKET_DEPARTMENT)
    if (d === null) return bad('부서 값이 올바르지 않습니다.')
    department = d
  }
  let projectId: string | null
  if (r.projectId === undefined && !requireProjectKeys) projectId = null
  else if (r.projectId === null) projectId = null
  else if (typeof r.projectId === 'string' && PROJECT_ID.test(r.projectId)) projectId = r.projectId
  else return bad('프로젝트 값이 올바르지 않습니다.')
  return { ok: true, value: { title, goal, criteria, assignee, department, projectId } }
}

function asRecord(raw: unknown, allowed: readonly string[]): Record<string, unknown> | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  // 알 수 없는 키(예: renderer가 보낸 id, status, 경로)는 조용히 무시하지 않고 거부한다.
  return Object.keys(r).every((k) => allowed.includes(k)) ? r : null
}

const CREATE_KEYS = ['title', 'goal', 'criteria', 'assignee', 'department', 'projectId']
const UPDATE_KEYS = ['id', 'expectedBody', ...CREATE_KEYS]

export function parseCreate(raw: unknown): Parsed<CreateInput> {
  const r = asRecord(raw, CREATE_KEYS)
  return r ? parseCommon(r, false) : bad('요청이 올바르지 않습니다.')
}

export function parseUpdate(raw: unknown): Parsed<UpdateInput> {
  const r = asRecord(raw, UPDATE_KEYS)
  if (!r) return bad('요청이 올바르지 않습니다.')
  if (typeof r.id !== 'string' || !TICKET_ID.test(r.id)) return bad('티켓 id가 올바르지 않습니다.')
  if (typeof r.expectedBody !== 'string' || r.expectedBody.length > MAX_TICKET_BODY_CHARS)
    return bad('편집을 시작한 시점의 본문이 필요합니다.')
  const common = parseCommon(r, true)
  if (!common.ok) return common
  return {
    ok: true,
    value: {
      ...common.value,
      id: r.id,
      expectedBody: r.expectedBody,
      assignee: common.value.assignee as string | null
    }
  }
}
