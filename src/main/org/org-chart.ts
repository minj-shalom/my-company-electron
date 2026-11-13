import type { OrgModel } from '../../shared/org'
import { EMPLOYEE_ID } from '../repository/ids'
import { MAX_CHART_LINES, MAX_LINE, chartLabelCol, splitChartText } from './parse-org-doc'

const FENCE = /^\s*(```|~~~)/
const CHART_HEADING = /^##\s+조직도/

/** 조직도 블록 괄호 안 id 목록과 직원 표가 같은지 비교한 불일치 목록. 블록이 없으면 비교하지 않는다. */
export function chartMismatches(org: OrgModel): string[] {
  if (org.chart.length === 0) return []
  const agents = new Set(org.members.flatMap((m) => (m.agentId === null ? [] : [m.agentId])))
  const labels = new Set(org.chart.map((c) => c.label.toLowerCase()))
  const inChart = new Set<string>()
  const out: string[] = []
  for (const c of org.chart) {
    const m = /\(([^()]*)\)/.exec(c.detail)
    if (m === null) continue
    for (const tok of m[1].split(',').map((t) => t.trim())) {
      if (!EMPLOYEE_ID.test(tok)) continue
      inChart.add(tok)
      if (!agents.has(tok)) out.push(`조직도 블록에만 있는 직원: ${tok}`)
    }
  }
  for (const m of org.members) {
    if (m.agentId === null) continue
    if (!inChart.has(m.agentId) && !labels.has(m.title.toLowerCase()))
      out.push(`직원 표에만 있는 직원: ${m.agentId}`)
  }
  return out
}

export type ChartChange =
  | {
      kind: 'add'
      agentId: string
      department: string
      reportsTo: string
      reportsToId: string | null
    }
  | { kind: 'remove'; agentId: string; title: string; memberTitles: string[] }
  | {
      kind: 'update'
      agentId: string
      oldTitle: string
      newTitle: string
      oldDepartment: string
      newDepartment: string
      reportsTo: string
      reportsToId: string | null
    }

export type ChartResult = { ok: true; text: string } | { ok: false }

export interface Node {
  idx: number
  col: number
  label: string
  detail: string
  parent: number | null
}

interface Chart {
  nodes: Node[]
}

/** parseChart와 같은 규칙으로 조직도 블록의 줄을 찾는다. 블록이 없으면 'none', 닫히지 않았거나 너무 길면 'invalid'. */
export function readChart(lines: string[]): Chart | 'none' | 'invalid' {
  let i = 0
  let fence = false
  for (; i < lines.length; i++) {
    if (FENCE.test(lines[i])) fence = !fence
    if (!fence && CHART_HEADING.test(lines[i])) break
  }
  if (i >= lines.length) return 'none'
  let open = -1
  for (i = i + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) break
    if (FENCE.test(lines[i])) {
      open = i
      break
    }
  }
  if (open < 0) return 'none'
  const nodes: Node[] = []
  const stack: Array<{ col: number; n: number }> = []
  for (i = open + 1; i < lines.length; i++) {
    const line = lines[i]
    if (FENCE.test(line)) return { nodes }
    if (!line.trim()) continue
    if (nodes.length >= MAX_CHART_LINES) return 'invalid'
    const col = chartLabelCol(line)
    if (col < 0) continue
    const { label, detail } = splitChartText(line.slice(col, MAX_LINE).trim())
    while (stack.length && stack[stack.length - 1].col >= col) stack.pop()
    nodes.push({
      idx: i,
      col,
      label,
      detail,
      parent: stack.length ? stack[stack.length - 1].n : null
    })
    stack.push({ col, n: nodes.length - 1 })
  }
  return 'invalid'
}

interface Group {
  start: number
  end: number
  tokens: string[]
  sep: string
}

export function groupOf(line: string, node: Node): Group | null {
  if (!node.detail) return null
  const m = /\(([^()]*)\)/.exec(node.detail)
  if (!m) return null
  const from = line.indexOf(node.detail, node.col + node.label.length)
  if (from < 0) return null
  const start = from + m.index
  const inner = m[1]
  return {
    start,
    end: start + m[0].length,
    tokens: inner
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t !== ''),
    sep: inner.includes(', ') || !inner.includes(',') ? ', ' : ','
  }
}

const render = (g: Group): string => `(${g.tokens.join(g.sep)})`

/** 항목 이름: `개발팀 (..)`은 라벨, `CTO ── 개발팀 (..)`은 대시 뒤의 이름. */
export function deptName(n: Node): string {
  const head = n.detail.split('(')[0].trim()
  return head !== '' ? head : n.label
}

export const descendants = (nodes: Node[], at: number): number[] => {
  const out: number[] = []
  for (let i = at + 1; i < nodes.length && nodes[i].col > nodes[at].col; i++) out.push(i)
  return out
}

/**
 * org.md 본문(직원 표 갱신이 끝난 텍스트)의 조직도 블록을 직원 변경에 맞춘다.
 * 사용자가 쓴 다른 줄은 그대로 두고, 해당 줄만 고치거나 더하거나 지운다. 줄바꿈 문자도 줄 단위로 보존한다.
 * 블록이 없으면 그대로 돌려준다. 구조를 확실히 알 수 없으면 `{ ok: false }`로 거부한다.
 */
export function syncChartText(text: string, change: ChartChange): ChartResult {
  const parts = text.split(/(\r?\n)/)
  const lines: string[] = []
  const seps: string[] = []
  for (let i = 0; i < parts.length; i += 2) {
    lines.push(parts[i])
    seps.push(parts[i + 1] ?? '')
  }
  const eol = seps.find((s) => s !== '') ?? '\n'
  const done = (): ChartResult => {
    let out = ''
    for (let i = 0; i < lines.length; i++) out += lines[i] + seps[i]
    return { ok: true, text: out }
  }

  const first = readChart(lines)
  if (first === 'none') return { ok: true, text }
  if (first === 'invalid') return { ok: false }

  const fresh = (): Node[] | null => {
    const c = readChart(lines)
    return typeof c === 'string' ? null : c.nodes
  }

  if (change.kind === 'remove') {
    if (!removeEverywhere(lines, seps, change.agentId, change.title, change.memberTitles))
      return { ok: false }
    return done()
  }

  if (change.kind === 'update') {
    if (change.newTitle !== change.oldTitle) {
      const nodes = fresh()
      if (nodes === null) return { ok: false }
      for (const n of nodes) {
        if (n.label !== change.oldTitle) continue
        const l = lines[n.idx]
        lines[n.idx] = l.slice(0, n.col) + change.newTitle + l.slice(n.col + n.label.length)
      }
    }
    if (change.newDepartment === change.oldDepartment) return done()
    const nodes = fresh()
    if (nodes === null) return { ok: false }
    // id가 어떤 목록에도 없으면 (라벨로만 표시된 직원) 부서 이동을 반영하지 않는다.
    const listed = nodes.some((n) => groupOf(lines[n.idx], n)?.tokens.includes(change.agentId))
    if (!listed) return done()
    if (!removeIdOnly(lines, seps, change.agentId, [change.newTitle])) return { ok: false }
  }

  const dept = change.kind === 'add' ? change.department : change.newDepartment
  if (
    !addToDepartment(lines, seps, eol, change.agentId, dept, change.reportsTo, change.reportsToId)
  )
    return { ok: false }
  return done()
}

/** 목록에서 id를 빼고, 비게 된 줄을 정리한다 (제목 라벨 줄은 건드리지 않는다). */
function removeIdOnly(lines: string[], seps: string[], id: string, titles: string[]): boolean {
  return removeEverywhere(lines, seps, id, null, titles)
}

function removeEverywhere(
  lines: string[],
  seps: string[],
  id: string,
  title: string | null,
  memberTitles: string[]
): boolean {
  const chart = readChart(lines)
  if (typeof chart === 'string') return chart === 'none'
  const { nodes } = chart
  const titles = new Set(memberTitles.map((t) => t.toLowerCase()))
  const lower = title?.toLowerCase() ?? null
  const deleted = new Set<number>()
  for (let k = nodes.length - 1; k >= 0; k--) {
    const n = nodes[k]
    const line = lines[n.idx]
    const g = groupOf(line, n)
    let residual = line
    let touched = false
    if (g !== null && g.tokens.includes(id)) {
      touched = true
      const tokens = g.tokens.filter((t) => t !== id)
      if (tokens.length > 0) {
        residual = line.slice(0, g.start) + render({ ...g, tokens }) + line.slice(g.end)
      } else {
        residual = (line.slice(0, g.start).trimEnd() + line.slice(g.end))
          .replace(/\s*─+\s*$/, '')
          .trimEnd()
      }
    }
    const isTitleLine = lower !== null && n.label.toLowerCase() === lower
    if (!touched && !isTitleLine) continue
    const leaf = descendants(nodes, k).length === 0
    const bare = splitChartText(residual.slice(n.col).trim()).detail === ''
    const emptied = touched && g !== null && g.tokens.every((t) => t === id)
    if (isTitleLine) {
      // 제목 라벨 줄은 자식이나 다른 설명이 없을 때만 지운다. 그렇지 않으면 구조를 알 수 없어 거부한다.
      if (!leaf || !bare) return false
      deleteNode(lines, seps, nodes, k, deleted)
      deleted.add(k)
    } else if (emptied && leaf && bare && !titles.has(n.label.toLowerCase())) {
      const head = line.slice(n.col).split('(')[0].trim()
      // `부서 (id)` 형태만 줄째 지운다. 다른 설명이 있는 줄은 괄호만 걷어낸다.
      if (head === n.label) {
        deleteNode(lines, seps, nodes, k, deleted)
        deleted.add(k)
      } else lines[n.idx] = residual
    } else lines[n.idx] = residual
  }
  return true
}

/** 줄을 지우고, 마지막 형제였다면 앞 형제의 `├`를 `└`로 되돌려 트리 모양을 유지한다. */
export function deleteNode(
  lines: string[],
  seps: string[],
  nodes: Node[],
  k: number,
  deleted: ReadonlySet<number> = new Set()
): void {
  const n = nodes[k]
  const corner = lines[n.idx].slice(0, n.col).indexOf('└')
  // 같은 호출에서 이미 지운 형제는 건너뛰어, 연속 삭제에서도 마지막 형제의 `└`가 이어지게 한다.
  const siblings = nodes
    .map((x, i) => ({ x, i }))
    .filter((s) => s.x.parent === n.parent && !deleted.has(s.i))
  const pos = siblings.findIndex((s) => s.i === k)
  if (corner >= 0 && pos > 0 && pos === siblings.length - 1) {
    const prev = siblings[pos - 1]
    const pl = lines[prev.x.idx]
    if (pl[corner] === '├') {
      lines[prev.x.idx] = pl.slice(0, corner) + '└' + pl.slice(corner + 1)
      for (let r = prev.x.idx + 1; r < n.idx; r++)
        if (lines[r][corner] === '│')
          lines[r] = lines[r].slice(0, corner) + ' ' + lines[r].slice(corner + 1)
    }
  }
  lines.splice(n.idx, 1)
  seps.splice(n.idx, 1)
}

function addToDepartment(
  lines: string[],
  seps: string[],
  eol: string,
  id: string,
  dept: string,
  reportsTo: string,
  reportsToId: string | null
): boolean {
  const chart = readChart(lines)
  if (typeof chart === 'string') return false
  const { nodes } = chart

  for (const n of nodes) {
    if (deptName(n) !== dept) continue
    const line = lines[n.idx]
    const g = groupOf(line, n)
    if (g !== null) {
      if (!g.tokens.every((t) => EMPLOYEE_ID.test(t))) continue
      if (g.tokens.includes(id)) return true
      lines[n.idx] =
        line.slice(0, g.start) + render({ ...g, tokens: [...g.tokens, id] }) + line.slice(g.end)
      return true
    }
    // 괄호가 없는 `CTO ── 개발팀`, `기획팀` 줄에는 목록을 새로 붙인다.
    if (n.detail.includes('(')) continue
    lines[n.idx] = `${line.trimEnd()} (${id})`
    return true
  }

  const pi = nodes.findIndex((n) => n.label === reportsTo)
  let parentAt =
    pi >= 0 ? pi : nodes.findIndex((n) => n.label.toLowerCase() === reportsTo.toLowerCase())
  // 보고 대상이 `기획팀 (pm)`처럼 부서 줄의 id로만 나타나면 그 줄을 부모로 본다.
  if (parentAt < 0 && reportsToId !== null)
    parentAt = nodes.findIndex((n) => groupOf(lines[n.idx], n)?.tokens.includes(reportsToId))
  if (parentAt < 0) return false
  const parent = nodes[parentAt]
  const kids = nodes.map((n, i) => ({ n, i })).filter((x) => x.n.parent === parentAt)
  const newText = `${dept} (${id})`
  if (kids.length === 0) {
    lines.splice(parent.idx + 1, 0, `${' '.repeat(parent.col + 1)}└─ ${newText}`)
    seps.splice(parent.idx + 1, 0, eol)
    return true
  }
  const last = kids[kids.length - 1]
  const prefix = lines[last.n.idx].slice(0, last.n.col)
  const at = descendants(nodes, last.i).reduce((m, i) => Math.max(m, nodes[i].idx), last.n.idx)
  const corner = prefix.indexOf('└')
  if (corner >= 0) {
    // 마지막 형제가 더는 마지막이 아니므로 `├`로 바꾸고, 그 하위 줄에는 세로선을 이어 그린다.
    lines[last.n.idx] =
      prefix.slice(0, corner) + '├' + prefix.slice(corner + 1) + lines[last.n.idx].slice(last.n.col)
    for (let r = last.n.idx + 1; r <= at; r++) {
      if (lines[r].length > corner && lines[r][corner] === ' ')
        lines[r] = lines[r].slice(0, corner) + '│' + lines[r].slice(corner + 1)
    }
  }
  lines.splice(at + 1, 0, prefix + newText)
  seps.splice(at + 1, 0, eol)
  return true
}
