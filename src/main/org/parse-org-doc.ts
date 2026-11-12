import type {
  OrgChartLine,
  OrgDepartment,
  OrgIssue,
  OrgMember,
  OrgModel,
  OrgTreeNode
} from '../../shared/org'
import { EMPLOYEE_ID } from '../repository/ids'

export const MAX_ORG_BYTES = 256 * 1024
export const MAX_ORG_ROWS = 500
const MAX_CELL = 300
const MAX_NAME = 60
const MAX_CHART_LINES = 200
export const MAIN_SESSION_FILE = 'CLAUDE.md'
export const HUMAN_CELL = '(사용자)'

const TABLE_HEADING = /^##\s+직원 목록/
const CHART_HEADING = /^##\s+조직도/
const FENCE = /^\s*(```|~~~)/
// eslint-disable-next-line no-control-regex -- 제어 문자 검출이 목적
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/

export interface TableLocation {
  /** 머리글 줄의 0-based 인덱스. 표가 없으면 null. */
  headerIdx: number | null
  /** 표(머리글, 구분선, 행)의 마지막 줄 인덱스. */
  lastIdx: number
  headers: string[]
  rows: Array<{ idx: number; cells: string[] }>
}

/** 이름(직급, 부서)으로 쓸 수 있는 값인지. 표 구분자, 줄바꿈, 제어 문자를 막는다. */
export function isValidName(v: string): boolean {
  return v.length > 0 && v.length <= MAX_NAME && !/[|`]/.test(v) && !CONTROL_CHARS.test(v)
}

/** 셀을 `|`로 나눈다. `\|`는 셀 안의 리터럴 `|`로 읽는다. */
export function splitRow(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  const cells: string[] = []
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '\\' && s[i + 1] === '|') {
      cur += '|'
      i++
    } else if (ch === '|') {
      cells.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  cells.push(cur.trim())
  return cells
}

/** 셀에 쓸 값을 이스케이프한다 (쓰기 쪽). */
export function escapeCell(v: string): string {
  return v.replace(/\|/g, '\\|')
}

const isSeparator = (line: string): boolean =>
  /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/.test(line)

/** `직원 목록` 아래 첫 표를 찾는다. 코드 펜스 안과 다음 `##` 이후는 보지 않는다. */
export function locateTable(lines: string[]): TableLocation | null {
  let fence = false
  let i = 0
  let found = false
  for (; i < lines.length; i++) {
    if (FENCE.test(lines[i])) fence = !fence
    if (!fence && TABLE_HEADING.test(lines[i])) {
      found = true
      i++
      break
    }
  }
  if (!found) return null
  fence = false
  for (; i < lines.length; i++) {
    if (FENCE.test(lines[i])) fence = !fence
    if (fence) continue
    if (/^##\s+/.test(lines[i])) return null
    if (lines[i].trim().startsWith('|')) break
  }
  if (i >= lines.length) return null
  const headerIdx = i
  const headers = splitRow(lines[i])
  let last = i
  const rows: TableLocation['rows'] = []
  for (i = i + 1; i < lines.length && lines[i].trim().startsWith('|'); i++) {
    last = i
    if (i === headerIdx + 1 && isSeparator(lines[i])) continue
    rows.push({ idx: i, cells: splitRow(lines[i]) })
  }
  return { headerIdx, lastIdx: last, headers, rows }
}

function parseChart(lines: string[], issues: OrgIssue[]): OrgChartLine[] {
  let i = 0
  let fence = false
  for (; i < lines.length; i++) {
    if (FENCE.test(lines[i])) fence = !fence
    if (!fence && CHART_HEADING.test(lines[i])) break
  }
  const out: OrgChartLine[] = []
  const stack: Array<{ col: number; label: string }> = []
  let inBlock = false
  for (i = i + 1; i < lines.length; i++) {
    const line = lines[i]
    if (!inBlock) {
      if (/^##\s+/.test(line)) break
      if (FENCE.test(line)) inBlock = true
      continue
    }
    if (FENCE.test(line)) break
    if (!line.trim()) continue
    if (out.length >= MAX_CHART_LINES) {
      issues.push({ code: 'too-many-rows', message: '조직도 블록이 너무 깁니다.', line: i + 1 })
      break
    }
    const col = line.search(/[^\s│├└─|`+\\-]/)
    if (col < 0) continue
    const text = line.slice(col).trim()
    const m = /^(.*?)(?:\s+──+\s*(.*)|\s+(\(.*\)))?$/.exec(text)
    const label = (m?.[1] ?? text).slice(0, MAX_CELL)
    const detail = (m?.[2] ?? m?.[3] ?? '').slice(0, MAX_CELL)
    while (stack.length && stack[stack.length - 1].col >= col) stack.pop()
    out.push({ label, parent: stack.length ? stack[stack.length - 1].label : null, detail })
    stack.push({ col, label })
  }
  return out
}

interface ParsedRef {
  kind: OrgMember['kind']
  agentId: string | null
}

function parseFileRef(cell: string): ParsedRef | null {
  if (cell === HUMAN_CELL) return { kind: 'human', agentId: null }
  // `CLAUDE.md` (메인 세션)처럼 뒤에 괄호 설명이 붙을 수 있다.
  const m = /^`([^`]*)`(?:\s*\([^)]*\))?$/.exec(cell)
  const ref = m ? m[1] : null
  if (ref === null) return null
  if (ref === MAIN_SESSION_FILE) return { kind: 'main-session', agentId: null }
  const id = ref.endsWith('.md') ? ref.slice(0, -3) : ref
  // 슬래시, `..`, 절대 경로는 id 형식에 맞지 않아 여기서 걸러진다 (파일 경로로 조합하지 않는다).
  return EMPLOYEE_ID.test(id) ? { kind: 'agent', agentId: id } : null
}

/** 터미널 표시 폭 (한글, CJK는 2칸). prettier가 정렬한 표의 열 너비에 맞추기 위해 쓴다. */
export function displayWidth(v: string): number {
  let w = 0
  for (const ch of v) {
    const c = ch.codePointAt(0) ?? 0
    w +=
      (c >= 0x1100 && c <= 0x115f) ||
      (c >= 0x2e80 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0xff00 && c <= 0xff60)
        ? 2
        : 1
  }
  return w
}

const MULTI = /[,;/、]/

/**
 * org.md 본문을 조직 모델로 바꾼다. 순수 함수이고 예외를 던지지 않는다.
 * 문제는 `issues`에 모으고 가능한 부분은 계속 파싱한다.
 * `agentIds`는 `.claude/agents/`에 실제로 있는 에이전트 id 목록이다.
 */
export function parseOrgDocument(text: string, agentIds: ReadonlySet<string>): OrgModel {
  const model: OrgModel = { members: [], departments: [], tree: [], chart: [], issues: [] }
  const { issues } = model
  if (Buffer.byteLength(text, 'utf8') > MAX_ORG_BYTES) {
    issues.push({ code: 'file-too-large', message: 'org.md가 너무 큽니다.' })
    return model
  }
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/)
  model.chart = parseChart(lines, issues)

  const table = locateTable(lines)
  if (!table) {
    issues.push({ code: 'no-table', message: '`직원 목록` 표를 찾지 못했습니다.' })
    return model
  }
  const col = (name: string): number => table.headers.findIndex((h) => h.includes(name))
  const [cTitle, cFile, cDept, cReports, cRole] = [
    col('직급'),
    col('직원 파일'),
    col('부서'),
    col('보고 대상'),
    col('역할')
  ]
  if (cTitle < 0 || cFile < 0) {
    issues.push({
      code: 'missing-columns',
      message: '표 머리글에 `직급`과 `직원 파일` 열이 필요합니다.',
      line: (table.headerIdx ?? 0) + 1
    })
    return model
  }
  if (table.rows.length === 0)
    issues.push({ code: 'no-table', message: '직원 표에 행이 없습니다.', line: table.lastIdx + 1 })

  const byTitle = new Map<string, OrgMember>()
  const byAgent = new Map<string, OrgMember>()
  const reportsToRaw = new Map<string, string>()
  const bad = (idx: number, message: string): void => {
    issues.push({ code: 'malformed-row', message, line: idx + 1 })
  }

  for (const [n, row] of table.rows.entries()) {
    const line = row.idx + 1
    if (n >= MAX_ORG_ROWS) {
      issues.push({ code: 'too-many-rows', message: '행이 너무 많아 나머지는 무시합니다.', line })
      break
    }
    const c = row.cells
    if (c.length !== table.headers.length) {
      bad(row.idx, `열 개수가 머리글과 다릅니다 (${c.length}/${table.headers.length}).`)
      continue
    }
    if (c.some((v) => v.length > MAX_CELL || CONTROL_CHARS.test(v))) {
      bad(row.idx, '셀이 너무 길거나 허용되지 않는 문자가 있습니다.')
      continue
    }
    const title = c[cTitle]
    if (!isValidName(title)) {
      bad(row.idx, '직급이 비었거나 허용되지 않는 형식입니다.')
      continue
    }
    const ref = parseFileRef(c[cFile])
    if (!ref)
      issues.push({
        code: 'invalid-file-ref',
        message: `${title}: 직원 파일 칸이 허용 형식이 아닙니다.`,
        line
      })

    const rawDept = cDept >= 0 ? c[cDept] : ''
    let department: string | null = rawDept === '' || rawDept === '-' ? null : rawDept
    if (department && MULTI.test(department)) {
      issues.push({
        code: 'multiple-departments',
        message: `${title}: 한 직원은 한 부서에만 속할 수 있습니다.`,
        line
      })
      department = department.split(MULTI)[0].trim() || null
    }
    if (department && !isValidName(department)) {
      bad(row.idx, '부서 이름이 허용되지 않는 형식입니다.')
      continue
    }

    const agentId = ref?.agentId ?? null
    const prior = byTitle.get(title) ?? (agentId ? byAgent.get(agentId) : undefined)
    if (prior) {
      issues.push({
        code: 'duplicate-employee',
        message: `${title}: 이미 나온 직급 또는 직원 파일입니다 (${prior.title}).`,
        line
      })
      if (department && prior.department && department !== prior.department)
        issues.push({
          code: 'multiple-departments',
          message: `${title}: 부서가 서로 다릅니다 (${prior.department}, ${department}).`,
          line
        })
      continue
    }

    let fileExists = true
    if (ref?.kind === 'agent' && agentId) {
      fileExists = agentIds.has(agentId)
      if (!fileExists)
        issues.push({
          code: 'missing-agent-file',
          message: `${title}: .claude/agents/${agentId}.md 파일이 없습니다.`,
          line
        })
    }
    if (!ref) fileExists = false

    const rawReports = cReports >= 0 ? c[cReports] : ''
    reportsToRaw.set(title, rawReports === '-' ? '' : rawReports)
    const member: OrgMember = {
      title,
      kind: ref?.kind ?? 'invalid',
      agentId,
      fileExists,
      department,
      reportsTo: null,
      role: cRole >= 0 ? c[cRole] : ''
    }
    byTitle.set(title, member)
    if (agentId) byAgent.set(agentId, member)
    model.members.push(member)
  }

  resolveReports(model, byTitle, reportsToRaw, lineOf(table, cTitle))
  breakCycles(model, byTitle)
  model.departments = buildDepartments(model.members)
  model.tree = buildTree(model.members)
  return model
}

function lineOf(table: TableLocation, cTitle: number): Map<string, number> {
  const m = new Map<string, number>()
  for (const r of table.rows) if (!m.has(r.cells[cTitle])) m.set(r.cells[cTitle], r.idx + 1)
  return m
}

function resolveReports(
  model: OrgModel,
  byTitle: Map<string, OrgMember>,
  raw: Map<string, string>,
  lines: Map<string, number>
): void {
  for (const m of model.members) {
    const target = raw.get(m.title) ?? ''
    if (!target) continue
    const line = lines.get(m.title)
    if (MULTI.test(target)) {
      model.issues.push({
        code: 'multiple-reports-to',
        message: `${m.title}: 보고 대상은 한 명이어야 합니다.`,
        line
      })
      continue
    }
    if (!byTitle.has(target)) {
      model.issues.push({
        code: 'unknown-reports-to',
        message: `${m.title}: 보고 대상 '${target}'이(가) 표에 없습니다.`,
        line
      })
      continue
    }
    m.reportsTo = target
  }
}

/** 순환을 찾아 오류로 보고하고, 순환을 닫는 간선 하나를 끊어 트리를 만들 수 있게 한다. */
function breakCycles(model: OrgModel, byTitle: Map<string, OrgMember>): void {
  const done = new Set<string>()
  for (const start of model.members) {
    const path: OrgMember[] = []
    const onPath = new Set<string>()
    let cur: OrgMember | undefined = start
    while (cur && !done.has(cur.title)) {
      if (onPath.has(cur.title)) {
        const cycle = path.slice(path.findIndex((p) => p.title === cur?.title))
        model.issues.push({
          code: 'cycle',
          message: `보고 라인이 순환합니다: ${[...cycle, cur].map((p) => p.title).join(' → ')}`
        })
        path[path.length - 1].reportsTo = null
        break
      }
      onPath.add(cur.title)
      path.push(cur)
      cur = cur.reportsTo ? byTitle.get(cur.reportsTo) : undefined
    }
    for (const p of path) done.add(p.title)
  }
}

function buildDepartments(members: OrgMember[]): OrgDepartment[] {
  const map = new Map<string, string[]>()
  for (const m of members) {
    if (m.department) map.set(m.department, [...(map.get(m.department) ?? []), m.title])
  }
  return [...map].map(([name, titles]) => ({ name, members: titles }))
}

function buildTree(members: OrgMember[]): OrgTreeNode[] {
  const nodes = new Map<string, OrgTreeNode>(
    members.map((m) => [m.title, { member: m, children: [] }])
  )
  const roots: OrgTreeNode[] = []
  for (const node of nodes.values()) {
    const parent = node.member.reportsTo ? nodes.get(node.member.reportsTo) : undefined
    ;(parent ? parent.children : roots).push(node)
  }
  return roots
}
