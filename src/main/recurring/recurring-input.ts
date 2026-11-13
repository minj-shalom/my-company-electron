import { PROJECT_ID, hasForbiddenChar } from '../../shared/project'
import {
  MAX_RECURRING_COUNT,
  RECURRING_ID,
  RECURRING_STATUSES,
  type RecurringDefinition
} from '../../shared/recurring'
import { EMPLOYEE_ID } from '../repository/ids'
import { parseCreate } from '../ticket/ticket-input'
import { parseCadence, renderTemplate } from './recurring-schedule'

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string }
const bad = (message: string): Parsed<never> => ({ ok: false, message })

const KEYS = [
  'id',
  'projectId',
  'titleTemplate',
  'goalTemplate',
  'criteriaTemplates',
  'cadence',
  'count',
  'assignee',
  'status'
]
const MAX_CRITERIA = 10
/** 검증용 가짜 날짜. 실제 날짜도 같은 길이라 치환 뒤 길이 검사가 어긋나지 않는다. */
const SAMPLE_DATE = '2000-01-01'
/** 개수가 2 이상이면 제목 뒤에 ` (n/m)`이 붙는다. */
const COUNT_SUFFIX = ' (5/5)'

/** 템플릿 문자열: 앞뒤 공백 없는 한 줄, 제어 문자 없음. 줄 구조를 바꿀 수 있는 입력은 받지 않는다. */
function template(v: unknown, max: number): string | null {
  if (typeof v !== 'string' || v.length === 0 || v.length > max * 2) return null
  if (v !== v.trim() || hasForbiddenChar(v) || [...v].length > max) return null
  return v
}

export function parseDefinition(raw: unknown): Parsed<RecurringDefinition> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    return bad('요청이 올바르지 않습니다.')
  const r = raw as Record<string, unknown>
  if (!Object.keys(r).every((k) => KEYS.includes(k))) return bad('요청이 올바르지 않습니다.')
  if (typeof r.id !== 'string' || !RECURRING_ID.test(r.id))
    return bad('id는 영문 소문자·숫자·-로 40자 이하여야 합니다.')
  if (typeof r.projectId !== 'string' || !PROJECT_ID.test(r.projectId))
    return bad('프로젝트 값이 올바르지 않습니다.')
  const title = template(r.titleTemplate, 300)
  if (title === null) return bad('제목 템플릿은 300자 이하의 한 줄이어야 합니다.')
  const goal = template(r.goalTemplate, 2000)
  if (goal === null) return bad('목표 템플릿은 2000자 이하의 한 줄이어야 합니다.')
  if (
    !Array.isArray(r.criteriaTemplates) ||
    r.criteriaTemplates.length < 1 ||
    r.criteriaTemplates.length > MAX_CRITERIA
  )
    return bad(`완료 조건은 1~${MAX_CRITERIA}개여야 합니다.`)
  const criteria: string[] = []
  for (const c of r.criteriaTemplates) {
    const one = template(c, 300)
    if (one === null) return bad('완료 조건은 300자 이하의 한 줄이어야 합니다.')
    criteria.push(one)
  }
  const cadence = typeof r.cadence === 'string' ? parseCadence(r.cadence) : null
  if (cadence === null) return bad('주기는 daily, weekdays, weekly:<요일 한 글자>여야 합니다.')
  if (
    typeof r.count !== 'number' ||
    !Number.isInteger(r.count) ||
    r.count < 1 ||
    r.count > MAX_RECURRING_COUNT
  )
    return bad(`개수는 1~${MAX_RECURRING_COUNT}이어야 합니다.`)
  let assignee: string | null
  if (r.assignee === null) assignee = null
  else if (typeof r.assignee === 'string' && EMPLOYEE_ID.test(r.assignee)) assignee = r.assignee
  else return bad('담당 직원 값이 올바르지 않습니다.')
  const status = RECURRING_STATUSES.find((s) => s === r.status)
  if (status === undefined) return bad('상태는 active 또는 paused여야 합니다.')

  // 실제 티켓 검증기로 가짜 날짜 치환 결과를 확인해, 저장 뒤에야 생성이 실패하는 정의를 막는다.
  const check = parseCreate({
    title: renderTemplate(title, SAMPLE_DATE) + (r.count > 1 ? COUNT_SUFFIX : ''),
    goal: renderTemplate(goal, SAMPLE_DATE),
    criteria: criteria.map((c) => renderTemplate(c, SAMPLE_DATE)),
    assignee: null,
    department: null,
    projectId: r.projectId
  })
  if (!check.ok) return bad(check.message)
  return {
    ok: true,
    value: {
      id: r.id,
      projectId: r.projectId,
      titleTemplate: title,
      goalTemplate: goal,
      criteriaTemplates: criteria,
      cadence,
      count: r.count,
      assignee,
      status
    }
  }
}

export function parseIdRequest(
  raw: unknown,
  withStatus: boolean
): Parsed<{ id: string; status: RecurringDefinition['status'] }> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    return bad('요청이 올바르지 않습니다.')
  const r = raw as Record<string, unknown>
  const allowed = withStatus ? ['id', 'status'] : ['id']
  if (!Object.keys(r).every((k) => allowed.includes(k))) return bad('요청이 올바르지 않습니다.')
  if (typeof r.id !== 'string' || !RECURRING_ID.test(r.id)) return bad('id가 올바르지 않습니다.')
  const status = withStatus ? RECURRING_STATUSES.find((s) => s === r.status) : 'active'
  if (status === undefined) return bad('상태는 active 또는 paused여야 합니다.')
  return { ok: true, value: { id: r.id, status } }
}
