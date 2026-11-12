import type { OrgDepartmentInput, OrgMemberInput, OrgModel } from '../../shared/org'
import type { ApiResult } from '../../shared/result'
import { EMPLOYEE_ID } from '../repository/ids'
import { FsGuardError, SafeFs } from '../repository/safe-fs'
import { AGENTS_DIR, ORG_FILE } from '../repository/parse-org'
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
const fail = (code: Fail['code'], message: string): Fail => ({ ok: false, code, message })

async function agentIdSet(fs: SafeFs): Promise<Set<string>> {
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

async function readOrgText(
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
function serialized<T>(root: string, task: () => Promise<T>): Promise<T> {
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

function validate(input: OrgMemberInput): string | null {
  const str = (v: unknown): v is string => typeof v === 'string'
  if (![input.title, input.agentId, input.department, input.reportsTo, input.role].every(str))
    return '입력 형식이 올바르지 않습니다.'
  // trim 후 달라지는 값은 표에서 다른 이름으로 읽히므로 정규화하지 않고 거부한다.
  if (!isValidName(input.title) || MULTI.test(input.title)) return '직급 형식이 올바르지 않습니다.'
  if (!isValidName(input.department) || MULTI.test(input.department))
    return '부서 이름 형식이 올바르지 않습니다.'
  if (!EMPLOYEE_ID.test(input.agentId)) return '직원 파일 id 형식이 올바르지 않습니다.'
  if (!isValidName(input.reportsTo)) return '보고 대상 형식이 올바르지 않습니다.'
  if (input.role.length > MAX_ROLE || CONTROL_CHARS.test(input.role))
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

    const eol = read.text.includes('\r\n') ? '\r\n' : '\n'
    const lines = read.text.split(/\r?\n/)
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
    lines.splice(table.lastIdx + 1, 0, row)
    const next = lines.join(eol)

    // 쓰기 전에 결과를 다시 파싱해 검증한다: 새 행이 정확히 하나 늘고 새 오류가 없어야 한다.
    // (행 수 제한 초과처럼 파서가 조용히 무시하는 경우도 여기서 걸린다.)
    const after = parseOrgDocument(next, agents)
    const added = after.members[after.members.length - 1]
    if (
      after.members.length !== model.members.length + 1 ||
      after.issues.length !== model.issues.length ||
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
