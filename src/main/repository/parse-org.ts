import type { Department, Employee, OrgChart } from '../../shared/employee'
import { asString, section, splitFrontmatter } from './markdown'
import { EMPLOYEE_ID } from './ids'

export const AGENTS_DIR = '.claude/agents'
export const ORG_FILE = 'company/org.md'

export interface OrgRow {
  title: string
  /** 직원 파일 셀에서 읽은 에이전트 id. 에이전트 파일이 없는 행(CEO, COO)은 null. */
  employeeId: string | null
  department: string | null
  reportsToTitle: string | null
}

/** `직원 목록` 표를 읽는다. 열 위치는 머리글 이름으로 찾는다. 표가 없으면 빈 배열. */
export function parseOrgRows(orgMarkdown: string): OrgRow[] {
  const sec = section(orgMarkdown, '직원 목록')
  if (!sec) return []
  const rows = sec
    .split(/\r?\n/)
    .filter((l) => l.trim().startsWith('|'))
    .map(splitRow)
  if (rows.length < 3) return []
  const header = rows[0]
  const col = (name: string): number => header.findIndex((h) => h.includes(name))
  const [cTitle, cFile, cDept, cReports] = [
    col('직급'),
    col('직원 파일'),
    col('부서'),
    col('보고 대상')
  ]
  if (cTitle < 0 || cFile < 0) return []
  return rows.slice(2).map((r) => {
    const fileCell = r[cFile] ?? ''
    const m = /^`([^`]+)`/.exec(fileCell)
    const ref = m && !m[1].endsWith('.md') ? m[1] : null
    return {
      title: r[cTitle] ?? '',
      employeeId: ref && EMPLOYEE_ID.test(ref) ? ref : null,
      department: cDept >= 0 ? clean(r[cDept]) : null,
      reportsToTitle: cReports >= 0 ? clean(r[cReports]) : null
    }
  })
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim())
}

function clean(v: string | undefined): string | null {
  return v && v !== '-' ? v : null
}

/** 에이전트 파일 하나를 직원으로 파싱한다 (조직 정보는 buildOrg에서 합친다). */
export function parseAgentFile(
  id: string,
  text: string
): Pick<Employee, 'id' | 'name' | 'description' | 'model'> {
  if (!EMPLOYEE_ID.test(id)) throw new Error('파일명이 허용 형식이 아닙니다.')
  const { data } = splitFrontmatter(text)
  const description = asString(data.description)
  if (!description) throw new Error('frontmatter에 description이 필요합니다.')
  return { id, name: asString(data.name) ?? id, description, model: asString(data.model) }
}

export function buildOrg(
  agents: Array<Pick<Employee, 'id' | 'name' | 'description' | 'model'>>,
  rows: OrgRow[]
): { org: OrgChart; orphanRows: OrgRow[] } {
  const byId = new Map(rows.filter((r) => r.employeeId).map((r) => [r.employeeId as string, r]))
  const idByTitle = new Map<string, string>()
  for (const a of agents) {
    const t = byId.get(a.id)?.title
    if (t) idByTitle.set(t, a.id)
  }
  const employees: Employee[] = agents.map((a) => {
    const row = byId.get(a.id)
    const reportsTo = row?.reportsToTitle ? (idByTitle.get(row.reportsToTitle) ?? null) : null
    return {
      id: a.id,
      name: a.name,
      description: a.description,
      department: row?.department ?? null,
      reportsTo: reportsTo === a.id ? null : reportsTo,
      title: row?.title || null,
      model: a.model,
      status: 'idle'
    }
  })
  const deptMap = new Map<string, string[]>()
  for (const e of employees) {
    if (!e.department) continue
    deptMap.set(e.department, [...(deptMap.get(e.department) ?? []), e.id])
  }
  const departments: Department[] = [...deptMap].map(([name, employeeIds]) => ({
    name,
    employeeIds
  }))
  const known = new Set(agents.map((a) => a.id))
  const orphanRows = rows.filter((r) => r.employeeId && !known.has(r.employeeId))
  return { org: { employees, departments }, orphanRows }
}
