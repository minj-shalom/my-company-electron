import type { OrgDepartmentInput, OrgMember, OrgMemberInput, OrgModel } from '../../shared/org'
import type { ApiResult } from '../../shared/result'
import { EMPLOYEE_ID } from '../repository/ids'
import { FsGuardError, SafeFs } from '../repository/safe-fs'
import { AGENTS_DIR, ORG_FILE } from '../repository/parse-org'
import { chartMismatches, syncChartText, type ChartChange } from './org-chart'
import {
  displayWidth,
  escapeCell,
  CONTROL_CHARS,
  isValidName,
  locateTable,
  MAX_ORG_BYTES,
  parseOrgDocument
} from './parse-org-doc'

const MAX_ROLE = 300
const MULTI = /[,;/、]/

type Fail = {
  ok: false
  code: 'invalid-request' | 'not-found' | 'conflict' | 'internal'
  message: string
}
export const CHART_REJECT =
  '조직도 블록을 자동으로 갱신할 수 없어 취소했습니다. 블록 형식을 확인하세요.'
export const fail = (code: Fail['code'], message: string): Fail => ({ ok: false, code, message })

export async function agentIdSet(fs: SafeFs): Promise<Set<string>> {
  const { files } = await fs.listMarkdown(AGENTS_DIR)
  return new Set(files.map((f) => f.slice(0, -3)))
}

/** 에이전트 폴더를 못 읽으면 빈 집합과 함께 알린다 (링크 등). 던지지 않는다. */
async function safeAgentIds(fs: SafeFs): Promise<{ ids: Set<string>; failed: boolean }> {
  try {
    return { ids: await agentIdSet(fs), failed: false }
  } catch {
    return { ids: new Set(), failed: true }
  }
}

/** org.md를 읽어 모델로 만든다. 읽기 실패와 파싱 문제는 던지지 않고 `issues`에 담는다. */
export async function loadOrg(fs: SafeFs): Promise<OrgModel> {
  const read = await readOrgText(fs)
  if (!read.ok) {
    return {
      members: [],
      departments: [],
      tree: [],
      chart: [],
      issues: [{ code: read.code, message: read.message }]
    }
  }
  const agents = await safeAgentIds(fs)
  const model = parseOrgDocument(read.text, agents.ids)
  if (agents.failed)
    model.issues.push({ code: 'unreadable', message: '.claude/agents 폴더를 읽을 수 없습니다.' })
  return model
}

export async function readOrgText(
  fs: SafeFs
): Promise<
  | { ok: true; text: string }
  | { ok: false; code: 'missing-org' | 'unreadable' | 'file-too-large'; message: string }
> {
  try {
    return { ok: true, text: await fs.readText(ORG_FILE) }
  } catch (e) {
    if (e instanceof FsGuardError) {
      if (e.kind === 'missing')
        return { ok: false, code: 'missing-org', message: 'org.md가 없습니다.' }
      if (e.kind === 'too-large')
        return { ok: false, code: 'file-too-large', message: 'org.md가 너무 큽니다.' }
    }
    // 내부 경로가 담긴 원본 메시지는 노출하지 않는다.
    return { ok: false, code: 'unreadable', message: 'org.md를 읽을 수 없습니다.' }
  }
}

// 같은 프로세스 안의 읽기-수정-쓰기가 서로 덮어쓰지 않도록 회사 폴더별로 직렬화한다.
const queues = new Map<string, Promise<unknown>>()
export function serialized<T>(root: string, task: () => Promise<T>): Promise<T> {
  const next = (queues.get(root) ?? Promise.resolve()).then(task, task)
  queues.set(
    root,
    next.catch(() => undefined)
  )
  return next
}

/** 부서와 부서장이 될 첫 직원을 함께 추가한다. 부서는 소속 직원이 있어야 표에 나타나기 때문이다. */
export async function addDepartment(
  fs: SafeFs,
  input: OrgDepartmentInput
): Promise<ApiResult<OrgModel>> {
  if (
    typeof input !== 'object' ||
    input === null ||
    typeof input.lead !== 'object' ||
    input.lead === null
  )
    return fail('invalid-request', '입력 형식이 올바르지 않습니다.')
  return addRow(fs, { ...input.lead, department: input.name }, true)
}

export async function addMember(fs: SafeFs, input: OrgMemberInput): Promise<ApiResult<OrgModel>> {
  return addRow(fs, input, false)
}

/** 조직도 블록의 줄 구조를 깨는 문자. 부서·직급 이름이 블록에 그대로 쓰이므로 거부한다. */
export const CHART_BREAKING = /[()│├└]|──/

function validate(input: OrgMemberInput): string | null {
  const str = (v: unknown): v is string => typeof v === 'string'
  if (![input.title, input.agentId, input.department, input.reportsTo, input.role].every(str))
    return '입력 형식이 올바르지 않습니다.'
  // trim 후 달라지는 값은 표에서 다른 이름으로 읽히므로 정규화하지 않고 거부한다.
  if (!isValidName(input.title) || MULTI.test(input.title) || CHART_BREAKING.test(input.title))
    return '직급 형식이 올바르지 않습니다.'
  if (
    !isValidName(input.department) ||
    MULTI.test(input.department) ||
    CHART_BREAKING.test(input.department)
  )
    return '부서 이름 형식이 올바르지 않습니다.'
  if (!EMPLOYEE_ID.test(input.agentId)) return '직원 파일 id 형식이 올바르지 않습니다.'
  if (!isValidName(input.reportsTo)) return '보고 대상 형식이 올바르지 않습니다.'
  if (
    input.role !== input.role.trim() ||
    input.role.length > MAX_ROLE ||
    CONTROL_CHARS.test(input.role)
  )
    return '역할 설명 형식이 올바르지 않습니다.'
  return null
}

function addRow(
  fs: SafeFs,
  input: OrgMemberInput,
  newDepartment: boolean
): Promise<ApiResult<OrgModel>> {
  return serialized(fs.root, async () => {
    try {
      return await addRowOnce(fs, input, newDepartment)
    } catch {
      return fail('internal', 'org.md를 갱신하지 못했습니다.')
    }
  })
}

/**
 * 읽기-수정-쓰기. 쓰기 직전에 다시 읽어 달라졌으면 한 번 더 시도하고, 그래도 달라지면 conflict.
 * 남는 위험: 마지막 재읽기와 rename 사이에 다른 프로세스(CLI 에이전트 등)가 쓰면 그 변경이 사라진다.
 * 파일 잠금이 없어 막을 수 없고, 창은 매우 짧다.
 */
async function addRowOnce(
  fs: SafeFs,
  input: OrgMemberInput,
  newDepartment: boolean
): Promise<ApiResult<OrgModel>> {
  const invalid = validate(input)
  if (invalid) return fail('invalid-request', invalid)

  for (let attempt = 0; attempt < 2; attempt++) {
    const read = await readOrgText(fs)
    if (!read.ok) return fail(read.code === 'missing-org' ? 'not-found' : 'internal', read.message)
    if (Buffer.byteLength(read.text, 'utf8') > MAX_ORG_BYTES)
      return fail('internal', 'org.md가 너무 큽니다.')

    const agents = await agentIdSet(fs)
    const model = parseOrgDocument(read.text, agents)
    if (model.members.some((m) => m.title === input.title || m.agentId === input.agentId))
      return fail('conflict', '이미 있는 직급 또는 직원입니다.')
    if (newDepartment && model.departments.some((d) => d.name === input.department))
      return fail('conflict', '이미 있는 부서입니다.')
    if (!agents.has(input.agentId))
      return fail('invalid-request', `.claude/agents/${input.agentId}.md 파일이 없습니다.`)
    if (!model.members.some((m) => m.title === input.reportsTo))
      return fail('invalid-request', '보고 대상이 표에 없습니다.')

    // 줄과 줄바꿈을 따로 들고 있어 새 줄 말고는 줄바꿈(CRLF 혼재 포함)을 그대로 보존한다.
    const parts = read.text.split(/(\r?\n)/)
    const lines: string[] = []
    for (let i = 0; i < parts.length; i += 2) lines.push(parts[i])
    const table = locateTable(lines)
    if (!table || table.headerIdx === null)
      return fail('invalid-request', '직원 표를 찾지 못했습니다.')
    const h = (name: string): number => table.headers.findIndex((x) => x.includes(name))
    const [cTitle, cFile] = [h('직급'), h('직원 파일')]
    if (cTitle < 0 || cFile < 0)
      return fail('invalid-request', '직원 표 머리글이 올바르지 않습니다.')

    const cells = table.headers.map((_, i) => {
      if (i === cTitle) return input.title
      if (i === cFile) return `\`${input.agentId}\``
      if (i === h('부서')) return input.department
      if (i === h('보고 대상')) return input.reportsTo
      if (i === h('역할')) return input.role
      return ''
    })
    // 기존 표가 열 너비에 맞춰 정렬되어 있으면 같은 너비로 맞춘다 (넘치면 그대로 둔다).
    const widths = table.headers.map((hd, i) =>
      Math.max(displayWidth(hd), ...table.rows.map((r) => displayWidth(r.cells[i] ?? '')))
    )
    const row = `| ${cells
      .map(escapeCell)
      .map((c, i) => c + ' '.repeat(Math.max(0, widths[i] - displayWidth(c))))
      .join(' | ')} |`
    // 표 마지막 줄의 줄바꿈을 새 줄에도 쓴다. 마지막 줄이면 문서의 첫 줄바꿈을 쓴다.
    const lastSep = parts[2 * table.lastIdx + 1]
    if (lastSep !== undefined) parts.splice(2 * table.lastIdx + 2, 0, row, lastSep)
    else parts.push(parts.find((_, i) => i % 2 === 1) ?? '\n', row)
    let next = parts.join('')
    if (model.chart.length > 0) {
      const synced = syncChartText(next, {
        kind: 'add',
        agentId: input.agentId,
        department: input.department,
        reportsTo: input.reportsTo,
        reportsToId: model.members.find((m) => m.title === input.reportsTo)?.agentId ?? null
      })
      if (!synced.ok) return fail('invalid-request', CHART_REJECT)
      next = synced.text
    }

    // 쓰기 전에 결과를 다시 파싱해 검증한다: 새 행이 정확히 하나 늘고 새 오류가 없어야 한다.
    // (행 수 제한 초과처럼 파서가 조용히 무시하는 경우도 여기서 걸린다.)
    const after = parseOrgDocument(next, agents)
    const added = after.members[after.members.length - 1]
    // 기존 오류를 해소하는 추가(예: 없던 보고 대상을 채움)는 허용하고, 새로 생긴 오류만 막는다.
    const known = new Set(model.issues.map((i) => `${i.code}:${i.message}`))
    const hasNewIssue = after.issues.some((i) => !known.has(`${i.code}:${i.message}`))
    if (
      after.members.length !== model.members.length + 1 ||
      hasNewIssue ||
      hasNewChartMismatch(model, after) ||
      added?.title !== input.title ||
      added.agentId !== input.agentId ||
      added.department !== input.department ||
      added.reportsTo !== input.reportsTo ||
      added.role !== input.role
    )
      return fail('invalid-request', '추가한 행이 표에서 올바르게 읽히지 않아 취소했습니다.')

    const current = await readOrgText(fs)
    if (!current.ok || current.text !== read.text) continue

    await fs.writeText(ORG_FILE, next)
    return { ok: true, value: after }
  }
  return fail('conflict', 'org.md가 동시에 수정되고 있습니다. 다시 시도하세요.')
}

export interface OrgMemberPatch {
  title?: string
  department?: string
  reportsTo?: string
  role?: string
}

type RowEdit = { kind: 'update'; patch: OrgMemberPatch } | { kind: 'remove' }

function validatePatch(patch: OrgMemberPatch): string | null {
  if (typeof patch !== 'object' || patch === null) return '입력 형식이 올바르지 않습니다.'
  const { title, department, reportsTo, role } = patch
  if (
    title === undefined &&
    department === undefined &&
    reportsTo === undefined &&
    role === undefined
  )
    return '바꿀 값이 없습니다.'
  const merged: OrgMemberInput = {
    title: title ?? 'x',
    department: department ?? 'x',
    reportsTo: reportsTo ?? 'x',
    role: role ?? '',
    agentId: 'x'
  }
  return validate(merged)
}

/** 직원(agentId)의 표 행에서 직급, 부서, 보고 대상, 역할만 바꾼다. 다른 줄은 바이트 그대로 둔다. */
export function updateMember(
  fs: SafeFs,
  agentId: string,
  patch: OrgMemberPatch
): Promise<ApiResult<OrgModel>> {
  return editRow(fs, agentId, { kind: 'update', patch })
}

/** 직원(agentId)의 표 행을 지운다. 직원 파일은 건드리지 않는다. */
export function removeMember(fs: SafeFs, agentId: string): Promise<ApiResult<OrgModel>> {
  return editRow(fs, agentId, { kind: 'remove' })
}

function editRow(fs: SafeFs, agentId: string, edit: RowEdit): Promise<ApiResult<OrgModel>> {
  return serialized(fs.root, async () => {
    try {
      return await editRowOnce(fs, agentId, edit)
    } catch {
      return fail('internal', 'org.md를 갱신하지 못했습니다.')
    }
  })
}

/** 쓰기 전 상태에 없던 조직도 블록 불일치가 생겼는지 (T-052 chart-mismatch와 같은 기준). */
export function hasNewChartMismatch(before: OrgModel, after: OrgModel): boolean {
  const known = new Set(chartMismatches(before))
  return chartMismatches(after).some((m) => !known.has(m))
}

function chartChangeOf(
  edit: RowEdit,
  member: OrgMember,
  expected: { title: string; department: string; reportsTo: string } | null,
  memberTitles: string[],
  reportsToId: string | null
): ChartChange | null {
  const agentId = member.agentId
  if (agentId === null) return null
  if (edit.kind === 'remove' || expected === null)
    return { kind: 'remove', agentId, title: member.title, memberTitles }
  const oldDepartment = member.department ?? ''
  if (expected.title === member.title && expected.department === oldDepartment) return null
  return {
    kind: 'update',
    agentId,
    oldTitle: member.title,
    newTitle: expected.title,
    oldDepartment,
    newDepartment: expected.department,
    reportsTo: expected.reportsTo,
    reportsToId
  }
}

export const issueKey = (i: { code: string; message: string }): string => `${i.code}:${i.message}`

/** 직원 행 하나를 고치거나 지운다. 읽기-수정-재파싱 검증-재읽기 비교-쓰기 순서는 addRowOnce와 같다. */
async function editRowOnce(
  fs: SafeFs,
  agentId: string,
  edit: RowEdit
): Promise<ApiResult<OrgModel>> {
  if (typeof agentId !== 'string' || !EMPLOYEE_ID.test(agentId))
    return fail('invalid-request', '직원 파일 id 형식이 올바르지 않습니다.')
  if (edit.kind === 'update') {
    const invalid = validatePatch(edit.patch)
    if (invalid) return fail('invalid-request', invalid)
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    const read = await readOrgText(fs)
    if (!read.ok) return fail(read.code === 'missing-org' ? 'not-found' : 'internal', read.message)
    if (Buffer.byteLength(read.text, 'utf8') > MAX_ORG_BYTES)
      return fail('internal', 'org.md가 너무 큽니다.')

    const agents = await agentIdSet(fs)
    const model = parseOrgDocument(read.text, agents)
    const member = model.members.find((m) => m.kind === 'agent' && m.agentId === agentId)
    if (!member) return fail('not-found', '조직도에 없는 직원입니다.')

    // 줄과 줄바꿈을 따로 들고 있어 고치지 않는 줄의 줄바꿈(CRLF 혼재 포함)을 그대로 보존한다.
    const parts = read.text.split(/(\r?\n)/)
    const lines: string[] = []
    for (let i = 0; i < parts.length; i += 2) lines.push(parts[i])
    const view = lines.map((l, i) => (i === 0 ? l.replace(/^\uFEFF/, '') : l))
    const table = locateTable(view)
    if (!table || table.headerIdx === null)
      return fail('invalid-request', '직원 표를 찾지 못했습니다.')
    const h = (name: string): number => table.headers.findIndex((x) => x.includes(name))
    const [cTitle, cFile, cDept, cReports, cRole] = [
      h('직급'),
      h('직원 파일'),
      h('부서'),
      h('보고 대상'),
      h('역할')
    ]
    if (cTitle < 0 || cFile < 0)
      return fail('invalid-request', '직원 표 머리글이 올바르지 않습니다.')
    const row = table.rows.find(
      (r) => r.cells.length === table.headers.length && r.cells[cTitle] === member.title
    )
    if (!row) return fail('not-found', '조직도에 없는 직원입니다.')

    const known = new Set(model.issues.map(issueKey))
    const others = model.members.filter((m) => m !== member)
    let expected: { title: string; department: string; reportsTo: string; role: string } | null =
      null
    if (edit.kind === 'update') {
      const p = edit.patch
      expected = {
        title: p.title ?? member.title,
        department: p.department ?? member.department ?? '',
        reportsTo: p.reportsTo ?? member.reportsTo ?? '',
        role: p.role ?? member.role
      }
      if (p.title !== undefined && p.title !== member.title) {
        if (others.some((m) => m.title === p.title))
          return fail('conflict', '이미 있는 직급 또는 직원입니다.')
        if (others.some((m) => m.reportsTo === member.title))
          return fail('conflict', '다른 직원의 보고 대상인 직급은 바꿀 수 없습니다.')
      }
      if (p.reportsTo !== undefined && !model.members.some((m) => m.title === p.reportsTo))
        return fail('invalid-request', '보고 대상이 표에 없습니다.')
      const cells = row.cells.map((c, i) => {
        if (i === cTitle) return expected?.title ?? c
        if (i === cDept && p.department !== undefined) return p.department
        if (i === cReports && p.reportsTo !== undefined) return p.reportsTo
        if (i === cRole && p.role !== undefined) return p.role
        return c
      })
      const widths = table.headers.map((hd, i) =>
        Math.max(displayWidth(hd), ...table.rows.map((r) => displayWidth(r.cells[i] ?? '')))
      )
      parts[2 * row.idx] = `| ${cells
        .map(escapeCell)
        .map((c, i) => c + ' '.repeat(Math.max(0, widths[i] - displayWidth(c))))
        .join(' | ')} |`
    } else if (parts[2 * row.idx + 1] !== undefined) {
      parts.splice(2 * row.idx, 2)
    } else {
      // 마지막 줄이면 앞 줄의 줄바꿈까지 함께 지운다.
      parts.splice(2 * row.idx - 1, 2)
    }
    let next = parts.join('')
    const change = chartChangeOf(
      edit,
      member,
      expected,
      others.map((m) => m.title),
      model.members.find((m) => m.title === expected?.reportsTo)?.agentId ?? null
    )
    if (model.chart.length > 0 && change !== null) {
      const synced = syncChartText(next, change)
      if (!synced.ok) return fail('invalid-request', CHART_REJECT)
      next = synced.text
    }

    const after = parseOrgDocument(next, agents)
    const afterMember = after.members.find((m) => m.kind === 'agent' && m.agentId === agentId)
    const sameOthers = (): boolean =>
      JSON.stringify(after.members.filter((m) => m !== afterMember)) === JSON.stringify(others)
    const hasNewIssue = after.issues.some((i) => !known.has(issueKey(i)))
    const good =
      !hasNewIssue &&
      !hasNewChartMismatch(model, after) &&
      sameOthers() &&
      (expected === null
        ? afterMember === undefined && after.members.length === model.members.length - 1
        : after.members.length === model.members.length &&
          afterMember !== undefined &&
          afterMember.title === expected.title &&
          (afterMember.department ?? '') === expected.department &&
          (afterMember.reportsTo ?? '') === expected.reportsTo &&
          afterMember.role === expected.role)
    if (!good) return fail('invalid-request', '바꾼 행이 표에서 올바르게 읽히지 않아 취소했습니다.')

    const current = await readOrgText(fs)
    if (!current.ok || current.text !== read.text) continue

    await fs.writeText(ORG_FILE, next)
    return { ok: true, value: after }
  }
  return fail('conflict', 'org.md가 동시에 수정되고 있습니다. 다시 시도하세요.')
}
