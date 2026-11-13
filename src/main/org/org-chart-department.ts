import {
  deleteNode,
  deptName,
  descendants,
  groupOf,
  readChart,
  type ChartResult
} from './org-chart'

function split(text: string): { lines: string[]; seps: string[] } {
  const parts = text.split(/(\r?\n)/)
  const lines: string[] = []
  const seps: string[] = []
  for (let i = 0; i < parts.length; i += 2) {
    lines.push(parts[i])
    seps.push(parts[i + 1] ?? '')
  }
  return { lines, seps }
}

const join = (lines: string[], seps: string[]): string => lines.map((l, i) => l + seps[i]).join('')

/** 조직도 블록에서 이 이름의 부서 항목(`개발팀 (..)`, `CTO ── 개발팀 (..)`) 수. 블록이 없으면 0. */
export function countDepartmentNodes(text: string, name: string): number {
  const chart = readChart(split(text).lines)
  return typeof chart === 'string' ? 0 : chart.nodes.filter((n) => deptName(n) === name).length
}

/**
 * 조직도 블록의 부서 표기를 바꾼다. 다른 줄과 줄바꿈은 그대로 둔다.
 * 항목의 모양을 확실히 알 수 없으면 `{ ok: false }`로 거부한다. 블록이 없으면 그대로 돌려준다.
 */
export function renameDepartmentInChart(text: string, from: string, to: string): ChartResult {
  const { lines, seps } = split(text)
  const chart = readChart(lines)
  if (chart === 'none') return { ok: true, text }
  if (chart === 'invalid') return { ok: false }
  for (const n of chart.nodes) {
    if (deptName(n) !== from) continue
    const line = lines[n.idx]
    const at = n.col + n.label.length
    if (n.label === from) {
      lines[n.idx] = line.slice(0, n.col) + to + line.slice(at)
      continue
    }
    const dash = /^\s*─+\s*/.exec(line.slice(at))
    if (dash === null || !line.slice(at + dash[0].length).startsWith(from)) return { ok: false }
    const start = at + dash[0].length
    lines[n.idx] = line.slice(0, start) + to + line.slice(start + from.length)
  }
  return { ok: true, text: join(lines, seps) }
}

/**
 * 직원이 없는 부서의 조직도 항목을 지운다. 소속 id나 하위 항목이 남아 있으면 구조를 알 수 없어 거부한다.
 * `CTO ── 개발팀` 같은 직급 줄은 줄을 지우지 않고 부서 표기만 걷어낸다.
 */
export function removeDepartmentFromChart(text: string, name: string): ChartResult {
  const { lines, seps } = split(text)
  const chart = readChart(lines)
  if (chart === 'none') return { ok: true, text }
  if (chart === 'invalid') return { ok: false }
  const { nodes } = chart
  const deleted = new Set<number>()
  for (let k = nodes.length - 1; k >= 0; k--) {
    const n = nodes[k]
    if (deptName(n) !== name) continue
    const line = lines[n.idx]
    if ((groupOf(line, n)?.tokens.length ?? 0) > 0) return { ok: false }
    if (descendants(nodes, k).some((i) => !deleted.has(i))) return { ok: false }
    const at = n.col + n.label.length
    if (n.label === name) {
      if (line.slice(at).trim() !== '') return { ok: false }
      deleteNode(lines, seps, nodes, k, deleted)
      deleted.add(k)
    } else {
      const rest = /^\s*─+\s*/.exec(line.slice(at))
      if (rest === null || line.slice(at + rest[0].length).trim() !== name) return { ok: false }
      lines[n.idx] = line.slice(0, at).trimEnd()
    }
  }
  return { ok: true, text: join(lines, seps) }
}
