import { PROJECT_ID, hasForbiddenChar } from '../../shared/project'
import {
  MAX_RECURRING_COUNT,
  RECURRING_ID,
  RECURRING_STATUSES,
  type RecurringDefinition
} from '../../shared/recurring'
import { EMPLOYEE_ID } from '../repository/ids'
import { parseCadence } from './recurring-schedule'

/** `company/recurring.md`의 순수 파서·직렬화기 (파일 접근 없음). */
export const RECURRING_FILE = 'company/recurring.md'

const MAX_BLOCKS_PARSED = 200
const MAX_CRITERIA = 10
const HEADING = /^##[ \t]+반복:[ \t]*(\S+)[ \t]*$/
const ANY_H2 = /^##[ \t]/
const FIELD = /^[-*][ \t]+(프로젝트|제목|목표|완료 조건|주기|개수|담당|상태):[ \t]*(.*?)[ \t]*$/

export const DEFAULT_PREFACE = [
  '# 반복 업무',
  '',
  '> 정해진 주기로 backlog에 티켓을 만드는 정의다. 제목·목표·완료 조건에서 `{date}`만 오늘 날짜(YYYY-MM-DD)로 바뀐다.',
  '> 주기: `daily`, `weekdays`, `weekly:월`(요일 한 글자). 상태: `active`, `paused`.',
  ''
].join('\n')

export interface ParsedRecurring {
  preface: string
  defs: RecurringDefinition[]
  /** 읽지 못해 무시한 블록 수. */
  unreadable: number
  /** 첫 블록 뒤의 구역 순서. 정의가 아닌 구역(`## 메모` 등)과 블록 안의 알 수 없는 줄을 원문 그대로 다시 쓰기 위해 둔다. */
  layout: LayoutEntry[]
}

export type LayoutEntry = { raw: string } | { id: string; extra: string[] }

const oneLine = (v: string, max: number): boolean =>
  v.length > 0 && [...v].length <= max && !hasForbiddenChar(v)

function parseBlock(id: string, lines: string[]): RecurringDefinition | null {
  if (!RECURRING_ID.test(id)) return null
  const f = new Map<string, string[]>()
  for (const line of lines) {
    const m = FIELD.exec(line)
    if (m) f.set(m[1], [...(f.get(m[1]) ?? []), m[2]])
  }
  const one = (k: string): string | null => {
    const v = f.get(k)
    return v !== undefined && v.length === 1 ? v[0] : null
  }
  const projectId = one('프로젝트')
  const title = one('제목')
  const goal = one('목표')
  const criteria = f.get('완료 조건') ?? []
  const cadence = parseCadence(one('주기') ?? '')
  const countRaw = one('개수')
  const assignee = one('담당')
  const status = RECURRING_STATUSES.find((s) => s === one('상태'))
  const count = countRaw === null || countRaw === '' ? 1 : Number(countRaw)
  if (
    projectId === null ||
    !PROJECT_ID.test(projectId) ||
    title === null ||
    !oneLine(title, 300) ||
    goal === null ||
    !oneLine(goal, 2000) ||
    criteria.length < 1 ||
    criteria.length > MAX_CRITERIA ||
    !criteria.every((c) => oneLine(c, 300)) ||
    cadence === null ||
    !Number.isInteger(count) ||
    count < 1 ||
    count > MAX_RECURRING_COUNT ||
    (f.get('개수')?.length ?? 0) > 1 ||
    status === undefined
  )
    return null
  let who: string | null = null
  if (assignee !== null && assignee !== '' && assignee !== '없음') {
    if (!EMPLOYEE_ID.test(assignee)) return null
    who = assignee
  }
  return {
    id,
    projectId,
    titleTemplate: title,
    goalTemplate: goal,
    criteriaTemplates: criteria,
    cadence,
    count,
    assignee: who,
    status
  }
}

export function parseRecurring(text: string | null): ParsedRecurring {
  if (text === null) return { preface: DEFAULT_PREFACE, defs: [], unreadable: 0, layout: [] }
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/)
  const first = lines.findIndex((l) => HEADING.test(l))
  const preface = (first < 0 ? lines : lines.slice(0, first)).join('\n').trimEnd()
  const defs: RecurringDefinition[] = []
  const layout: LayoutEntry[] = []
  const seen = new Set<string>()
  let unreadable = 0
  let blocks = 0
  let i = first < 0 ? lines.length : first
  while (i < lines.length) {
    let end = i + 1
    while (end < lines.length && !ANY_H2.test(lines[end])) end++
    const section = lines.slice(i, end)
    const h = HEADING.exec(lines[i])
    if (!h) {
      layout.push({ raw: section.join('\n').trimEnd() })
      i = end
      continue
    }
    blocks++
    const body = section.slice(1)
    const def = blocks > MAX_BLOCKS_PARSED ? null : parseBlock(h[1], body)
    // 같은 id가 둘이면 먼저 나온 것만 쓴다 (중복 생성 방지).
    if (def === null || seen.has(def.id)) {
      unreadable++
      layout.push({ raw: section.join('\n').trimEnd() })
    } else {
      seen.add(def.id)
      defs.push(def)
      layout.push({ id: def.id, extra: body.filter((l) => l.trim() !== '' && !FIELD.test(l)) })
    }
    i = end
  }
  return {
    preface: preface === '' ? DEFAULT_PREFACE.trimEnd() : preface,
    defs,
    unreadable,
    layout
  }
}

const renderBlock = (d: RecurringDefinition, extra: string[]): string =>
  [
    `## 반복: ${d.id}`,
    `- 프로젝트: ${d.projectId}`,
    `- 제목: ${d.titleTemplate}`,
    `- 목표: ${d.goalTemplate}`,
    ...d.criteriaTemplates.map((c) => `- 완료 조건: ${c}`),
    `- 주기: ${d.cadence}`,
    `- 개수: ${d.count}`,
    `- 담당: ${d.assignee ?? '없음'}`,
    `- 상태: ${d.status}`,
    ...extra
  ].join('\n')

/** 기존 구역 순서(`layout`)를 지키고, 삭제된 정의는 빼고, 새 정의는 끝에 붙인다. */
export function serializeRecurring(
  preface: string,
  defs: RecurringDefinition[],
  layout: LayoutEntry[] = []
): string {
  const byId = new Map(defs.map((d) => [d.id, d]))
  const used = new Set<string>()
  const parts: string[] = []
  for (const e of layout) {
    if ('raw' in e) parts.push(e.raw)
    else {
      const d = byId.get(e.id)
      if (d === undefined) continue
      used.add(d.id)
      parts.push(renderBlock(d, e.extra))
    }
  }
  for (const d of defs) if (!used.has(d.id)) parts.push(renderBlock(d, []))
  return [preface.trimEnd(), ...parts].join('\n\n').trimEnd() + '\n'
}
