import { departmentKey, validateDepartmentName } from '../../shared/department'
import type { OrgModel } from '../../shared/org'
import type { ApiResult } from '../../shared/result'
import type { SafeFs } from '../repository/safe-fs'
import { ORG_FILE } from '../repository/parse-org'
import {
  countDepartmentNodes,
  removeDepartmentFromChart,
  renameDepartmentInChart
} from './org-chart-department'
import {
  CHART_REJECT,
  agentIdSet,
  fail,
  hasNewChartMismatch,
  issueKey,
  readOrgText,
  serialized
} from './org-store'
import {
  displayWidth,
  escapeCell,
  locateTable,
  MAX_ORG_BYTES,
  parseOrgDocument
} from './parse-org-doc'

type Done = ApiResult<OrgModel>

/** 부서 이름을 바꾼다. 직원 표의 모든 행과 조직도 블록을 한 번의 쓰기로 고친다. 실패하면 파일은 그대로다. */
export function renameDepartment(fs: SafeFs, from: string, to: string): Promise<Done> {
  return edit(fs, (text, model) => {
    const bad = validateDepartmentName(to)
    if (bad !== null) return fail('invalid-request', bad)
    if (typeof from !== 'string' || from === '')
      return fail('invalid-request', '부서 이름 형식이 올바르지 않습니다.')
    if (!model.departments.some((d) => d.name === from))
      return fail('not-found', '없는 부서입니다.')
    if (from === to) return fail('invalid-request', '바꿀 이름이 현재 이름과 같습니다.')
    if (
      model.departments.some((d) => d.name !== from && departmentKey(d.name) === departmentKey(to))
    )
      return fail('conflict', '이미 있는 부서 이름입니다.')
    if (countDepartmentNodes(text, to) > 0)
      return fail('conflict', '조직도에 같은 이름의 항목이 이미 있습니다.')

    const table = rewriteRows(text, (cells, c) =>
      cells[c.dept] === from ? { [c.dept]: to } : null
    )
    if (!table.ok) return table
    const chart = renameDepartmentInChart(table.value.text, from, to)
    if (!chart.ok) return fail('invalid-request', CHART_REJECT)

    const before = countDepartmentNodes(text, from)
    return {
      ok: true,
      value: {
        text: chart.text,
        check: (after) =>
          sameExcept(model, after, (m) => ({
            ...m,
            department: m.department === from ? to : m.department
          })) &&
          after.departments.some((d) => d.name === to) &&
          !after.departments.some((d) => d.name === from) &&
          countDepartmentNodes(chart.text, to) === before &&
          countDepartmentNodes(chart.text, from) === 0
      }
    }
  })
}

/**
 * 직원이 0명인 부서를 조직도 블록에서 지운다 (부서는 직원 표에만 있으므로 직원이 있으면 지울 수 없다).
 * 표에도 블록에도 없는 이름은 `not-found`.
 */
export function removeDepartment(fs: SafeFs, name: string): Promise<Done> {
  return edit(fs, (text, model) => {
    if (typeof name !== 'string' || name === '')
      return fail('invalid-request', '부서 이름 형식이 올바르지 않습니다.')
    const members = model.members.filter((m) => m.department === name)
    if (members.length > 0)
      return fail(
        'conflict',
        '소속 직원이 있는 부서는 지울 수 없습니다. 직원을 다른 부서로 옮기거나 퇴사 처리한 뒤 다시 시도하세요.'
      )
    if (countDepartmentNodes(text, name) === 0) return fail('not-found', '없는 부서입니다.')
    const chart = removeDepartmentFromChart(text, name)
    if (!chart.ok) return fail('invalid-request', CHART_REJECT)
    return {
      ok: true,
      value: {
        text: chart.text,
        check: (after) =>
          sameExcept(model, after, (m) => m) && countDepartmentNodes(chart.text, name) === 0
      }
    }
  })
}

interface Plan {
  text: string
  /** 새 본문을 다시 파싱한 모델이 의도와 같은지. */
  check: (after: OrgModel) => boolean
}

/** 부서가 바뀌는 것 말고는 모든 직원이 그대로인지. */
function sameExcept(
  before: OrgModel,
  after: OrgModel,
  map: (m: OrgModel['members'][number]) => OrgModel['members'][number]
): boolean {
  return JSON.stringify(before.members.map(map)) === JSON.stringify(after.members)
}

/**
 * 읽기-계획-재파싱 검증-재읽기 비교-단일 쓰기. addRowOnce와 같은 순서이며 쓰기는 한 번뿐이라
 * 중간에 실패해도 org.md는 바뀌지 않는다.
 */
function edit(fs: SafeFs, plan: (text: string, model: OrgModel) => ApiResult<Plan>): Promise<Done> {
  return serialized(fs.root, async () => {
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const read = await readOrgText(fs)
        if (!read.ok)
          return fail(read.code === 'missing-org' ? 'not-found' : 'internal', read.message)
        if (Buffer.byteLength(read.text, 'utf8') > MAX_ORG_BYTES)
          return fail('internal', 'org.md가 너무 큽니다.')
        const agents = await agentIdSet(fs)
        const model = parseOrgDocument(read.text, agents)
        const planned = plan(read.text, model)
        if (!planned.ok) return planned
        const { text: next, check } = planned.value

        const after = parseOrgDocument(next, agents)
        const known = new Set(model.issues.map(issueKey))
        if (
          after.issues.some((i) => !known.has(issueKey(i))) ||
          hasNewChartMismatch(model, after) ||
          !check(after)
        )
          return fail(
            'invalid-request',
            '바꾼 결과가 조직도에서 올바르게 읽히지 않아 취소했습니다.'
          )

        const current = await readOrgText(fs)
        if (!current.ok || current.text !== read.text) continue
        if (next !== read.text) await fs.writeText(ORG_FILE, next)
        return { ok: true, value: after }
      }
      return fail('conflict', 'org.md가 동시에 수정되고 있습니다. 다시 시도하세요.')
    } catch {
      // 내부 경로가 든 원문은 노출하지 않는다.
      return fail('internal', 'org.md를 갱신하지 못했습니다.')
    }
  })
}

interface Cols {
  dept: number
}

/** 직원 표 행을 고친다. 고치지 않는 줄은 줄바꿈까지 바이트 그대로 둔다. `change`가 null이면 그 행은 그대로. */
function rewriteRows(
  text: string,
  change: (cells: string[], cols: Cols) => Record<number, string> | null
): ApiResult<{ text: string }> {
  const parts = text.split(/(\r?\n)/)
  const lines: string[] = []
  for (let i = 0; i < parts.length; i += 2) lines.push(parts[i])
  const view = lines.map((l, i) => (i === 0 ? l.replace(/^\uFEFF/, '') : l))
  const table = locateTable(view)
  if (!table || table.headerIdx === null)
    return fail('invalid-request', '직원 표를 찾지 못했습니다.')
  const dept = table.headers.findIndex((x) => x.includes('부서'))
  if (dept < 0) return fail('invalid-request', '직원 표 머리글이 올바르지 않습니다.')
  const widths = table.headers.map((hd, i) =>
    Math.max(displayWidth(hd), ...table.rows.map((r) => displayWidth(r.cells[i] ?? '')))
  )
  for (const row of table.rows) {
    if (row.cells.length !== table.headers.length) continue
    const patch = change(row.cells, { dept })
    if (patch === null) continue
    const cells = row.cells.map((c, i) => patch[i] ?? c)
    parts[2 * row.idx] = `| ${cells
      .map(escapeCell)
      .map((c, i) => c + ' '.repeat(Math.max(0, widths[i] - displayWidth(c))))
      .join(' | ')} |`
  }
  return { ok: true, value: { text: parts.join('') } }
}
