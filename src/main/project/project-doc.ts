import { basename } from 'node:path'
import {
  MAX_BRANCH,
  MAX_DEV_COMMAND,
  MAX_PROJECT_PATH,
  PROJECT_ID,
  PROJECT_STATUSES,
  PROJECT_TYPES,
  checkProjectName,
  hasForbiddenChar,
  type ProjectStatus,
  type ProjectType
} from '../../shared/project'
import { formatFieldLine, parseFieldLine, parsePmValue } from './field-lines'

/**
 * `company/project.md`의 순수 파서/직렬화기 (파일 접근 없음).
 * 문서는 "원문 그대로 보존하는 줄 구간"과 "프로젝트 블록(`## 프로젝트: 이름`)"의 나열이다.
 * 바뀌지 않은 구간과 알 수 없는 줄(`직원:`, 정책, 스크립트용 `- project_dir:` 등)은 한 글자도 바꾸지 않는다.
 */

export const PROJECT_HEADING = '## 프로젝트:'
export const MAX_PROJECTS = 100
const MAX_BLOCKS_PARSED = 200

const KEY_ID = 'id'
const KEY_TYPE = '유형'
const KEY_PATH = '경로'
const KEY_DEV = 'dev 명령'
const KEY_BRANCH = '기본 브랜치'
const KEY_STATUS = '상태'
const KEY_PM = 'PM'
/** 새 줄을 추가할 때의 표준 순서. */
const CANONICAL_KEYS = [
  KEY_ID,
  KEY_TYPE,
  KEY_PATH,
  KEY_DEV,
  KEY_BRANCH,
  KEY_STATUS,
  KEY_PM
] as const
type KnownKey = (typeof CANONICAL_KEYS)[number]
const KNOWN: ReadonlySet<string> = new Set(CANONICAL_KEYS)

export interface DocProject {
  id: string
  name: string
  type: ProjectType
  /** 파일에 적힌 그대로의 경로. 상대 경로(기존 형식)는 회사 폴더 기준으로 읽는다. */
  path: string
  devCommand: string | null
  defaultBranch: string | null
  status: ProjectStatus
  pmId: string | null
}

type LayoutItem =
  { kind: 'heading' } | { kind: 'raw'; text: string } | { kind: 'field'; key: KnownKey }

type Segment =
  | { kind: 'raw'; lines: string[] }
  | {
      kind: 'block'
      /** 1부터 시작하는 제목 줄 번호. */
      line: number
      rawLines: string[]
      /** 읽을 수 없는 블록이면 null. 이 경우 원문 그대로 보존하고 수정하지 않는다. */
      project: DocProject | null
      layout: LayoutItem[]
      dirty: boolean
    }

export interface ProjectDoc {
  eol: '\n' | '\r\n'
  trailingNewline: boolean
  segments: Segment[]
  /** 새 형식 블록이 하나도 없을 때 기존 단일 형식 줄에서 해석한 프로젝트. */
  legacy: DocProject[] | null
}

const FENCE_MARKS = ['```', '~~~']
const isFence = (line: string): boolean => {
  const t = line.trimStart()
  return FENCE_MARKS.some((m) => t.startsWith(m))
}

function isValidDevCommand(v: string): boolean {
  return v.length > 0 && v.length <= MAX_DEV_COMMAND && !hasForbiddenChar(v)
}

/** git ref로 쓸 수 있는 보수적인 이름. `..`, 앞 `-`, 끝 `/`·`.lock`을 막는다. */
export function isValidBranch(v: string): boolean {
  return (
    v.length > 0 &&
    v.length <= MAX_BRANCH &&
    /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(v) &&
    !v.includes('..') &&
    !v.includes('//') &&
    !v.endsWith('/') &&
    !v.endsWith('.') &&
    !v.endsWith('.lock')
  )
}

/** 경로 값의 형태만 본다 (실존·포함 관계 검증은 project-path). */
export function isPlausiblePathValue(v: string): boolean {
  return v.length > 0 && v.length <= MAX_PROJECT_PATH && !hasForbiddenChar(v)
}

function parseBlockFields(
  name: string,
  body: string[],
  inFence: boolean[]
): { project: DocProject | null; layout: LayoutItem[] } {
  const layout: LayoutItem[] = [{ kind: 'heading' }]
  const fields = new Map<string, string>()
  let bad = checkProjectName(name) !== null
  body.forEach((line, i) => {
    const f = inFence[i] ? null : parseFieldLine(line)
    if (f === null || !KNOWN.has(f.key)) {
      layout.push({ kind: 'raw', text: line })
      return
    }
    layout.push({ kind: 'field', key: f.key as KnownKey })
    // 같은 키가 두 번 나오면 어느 쪽이 맞는지 알 수 없다. 위조 가능성이 있어 블록 전체를 신뢰하지 않는다.
    if (f.forged || fields.has(f.key)) bad = true
    else fields.set(f.key, f.value)
  })
  if (bad) return { project: null, layout }

  const id = fields.get(KEY_ID)
  const path = fields.get(KEY_PATH)
  if (id === undefined || !PROJECT_ID.test(id)) return { project: null, layout }
  if (path === undefined || !isPlausiblePathValue(path)) return { project: null, layout }
  const type = fields.get(KEY_TYPE) ?? 'development'
  const status = fields.get(KEY_STATUS) ?? 'active'
  if (!(PROJECT_TYPES as readonly string[]).includes(type)) return { project: null, layout }
  if (!(PROJECT_STATUSES as readonly string[]).includes(status)) return { project: null, layout }
  const dev = fields.get(KEY_DEV)
  const branch = fields.get(KEY_BRANCH)
  const pm = fields.get(KEY_PM)
  if (dev !== undefined && !isValidDevCommand(dev)) return { project: null, layout }
  if (branch !== undefined && !isValidBranch(branch)) return { project: null, layout }
  // `PM:` 값이 비어 있는 것은 "없음"과 같다. 형식이 틀린 값은 블록을 신뢰하지 않는다.
  let pmId: string | null = null
  if (pm !== undefined && pm !== '') {
    pmId = parsePmValue(pm)
    if (pmId === null) return { project: null, layout }
  }
  return {
    project: {
      id,
      name,
      type: type as ProjectType,
      path,
      devCommand: dev ?? null,
      defaultBranch: branch ?? null,
      status: status as ProjectStatus,
      pmId
    },
    layout
  }
}

/** 이름에서 id를 만든다. 영문·숫자 외는 `-`로 바꾸므로 한글뿐인 이름은 `project`가 된다. 중복이면 `-2`, `-3`... */
export function makeProjectId(name: string, taken: ReadonlySet<string>): string {
  let base = ''
  let dash = false
  for (const ch of name.toLowerCase()) {
    if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) {
      if (dash && base !== '') base += '-'
      base += ch
      dash = false
    } else dash = true
    if (base.length >= 32) break
  }
  if (base === '') base = 'project'
  let id = base
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`
  return id
}

const UNSET = '(미설정)'

/** 기존 단일 형식(`project_name`, `project_dir`, `dev_command`, `extra_project_dirs`)을 프로젝트 목록으로 해석한다. */
function legacyProjects(lines: string[]): DocProject[] {
  const found = new Map<string, string>()
  let fence = false
  for (const line of lines) {
    if (isFence(line)) {
      fence = !fence
      continue
    }
    if (fence) continue
    const f = parseFieldLine(line)
    // scripts/*.sh는 첫 일치 줄을 쓴다. 같은 규칙을 따른다.
    if (f && !f.forged && !found.has(f.key)) found.set(f.key, f.value)
  }
  const set = (key: string): string | null => {
    const v = found.get(key)
    return v === undefined || v === '' || v === UNSET ? null : v
  }
  const paths: string[] = []
  const first = set('project_dir')
  if (first !== null) paths.push(first)
  for (const p of (set('extra_project_dirs') ?? '').split(',')) {
    const t = p.trim()
    if (t !== '' && t !== UNSET && !paths.includes(t)) paths.push(t)
  }
  const out: DocProject[] = []
  const ids = new Set<string>()
  const names = new Set<string>()
  paths.forEach((path, i) => {
    if (!isPlausiblePathValue(path)) return
    const declared = i === 0 ? set('project_name') : null
    let name = declared !== null && checkProjectName(declared) === null ? declared : basename(path)
    if (checkProjectName(name) !== null) name = `프로젝트 ${i + 1}`
    for (let n = 2; names.has(name.toLowerCase()); n++) name = `${name.slice(0, 44)} ${n}`
    names.add(name.toLowerCase())
    const dev = i === 0 ? set('dev_command') : null
    const id = makeProjectId(name, ids)
    ids.add(id)
    out.push({
      id,
      name,
      type: 'development',
      path,
      devCommand: dev !== null && isValidDevCommand(dev) ? dev : null,
      defaultBranch: null,
      status: 'active',
      pmId: null
    })
  })
  return out
}

export function parseProjectDoc(text: string): ProjectDoc {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split('\n')
  const trailingNewline = lines.length > 1 && lines[lines.length - 1] === ''
  if (trailingNewline) lines.pop()
  // CRLF 파일에서만 줄 끝 `\r`을 줄 경계로 본다. 그 밖의 단독 `\r`은 줄 안의 문자라 필드 위조 검사에 걸린다.
  if (eol === '\r\n') for (let i = 0; i < lines.length; i++) lines[i] = lines[i].replace(/\r$/, '')

  const segments: Segment[] = []
  let raw: string[] | null = null
  let block: { name: string; line: number; lines: string[]; fence: boolean[] } | null = null
  let fence = false
  let blocks = 0

  const closeBlock = (): void => {
    if (block === null) return
    const [headingLine, ...body] = block.lines
    const { project, layout } = parseBlockFields(block.name, body, block.fence)
    segments.push({
      kind: 'block',
      line: block.line,
      rawLines: [headingLine, ...body],
      project,
      layout,
      dirty: false
    })
    block = null
  }

  lines.forEach((line, i) => {
    const heading = !fence && line.startsWith('## ')
    if (heading) {
      closeBlock()
      raw = null
      if (line.startsWith(PROJECT_HEADING)) {
        blocks += 1
        block = {
          name: line.slice(PROJECT_HEADING.length).trim(),
          line: i + 1,
          lines: [line],
          fence: []
        }
        return
      }
    }
    if (block !== null) {
      block.lines.push(line)
      block.fence.push(fence || isFence(line))
      if (isFence(line)) fence = !fence
      return
    }
    if (raw === null) {
      raw = []
      segments.push({ kind: 'raw', lines: raw })
    }
    raw.push(line)
    if (isFence(line)) fence = !fence
  })
  closeBlock()

  // 지나치게 많은 블록은 처리량을 제한하려고 초과분을 읽을 수 없는 블록으로 취급한다.
  if (blocks > MAX_BLOCKS_PARSED) {
    let seen = 0
    for (const s of segments) if (s.kind === 'block' && ++seen > MAX_BLOCKS_PARSED) s.project = null
  }

  // 같은 id나 같은 이름의 블록이 겹치면 뒤의 것은 신뢰하지 않는다 (구조 위조와 참조 모호성 방지).
  const ids = new Set<string>()
  const names = new Set<string>()
  for (const s of segments) {
    if (s.kind !== 'block' || s.project === null) continue
    const key = s.project.name.normalize('NFKC').toLowerCase()
    if (ids.has(s.project.id) || names.has(key)) s.project = null
    else {
      ids.add(s.project.id)
      names.add(key)
    }
  }

  const legacy = blocks === 0 ? legacyProjects(lines) : null
  return { eol, trailingNewline, segments, legacy }
}

export interface ProjectDocView {
  items: DocProject[]
  /** 읽을 수 없는 블록의 제목 줄 번호. */
  issueLines: number[]
  format: 'blocks' | 'legacy' | 'empty'
}

export function viewProjectDoc(doc: ProjectDoc): ProjectDocView {
  if (doc.legacy !== null)
    return {
      items: doc.legacy.map((p) => ({ ...p })),
      issueLines: [],
      format: doc.legacy.length > 0 ? 'legacy' : 'empty'
    }
  const items: DocProject[] = []
  const issueLines: number[] = []
  for (const s of doc.segments) {
    if (s.kind !== 'block') continue
    if (s.project === null) issueLines.push(s.line)
    else items.push({ ...s.project })
  }
  return {
    items,
    issueLines,
    format: items.length > 0 || issueLines.length > 0 ? 'blocks' : 'empty'
  }
}

function fieldValues(p: DocProject): Record<KnownKey, string | null> {
  return {
    [KEY_ID]: p.id,
    [KEY_TYPE]: p.type,
    [KEY_PATH]: p.path,
    [KEY_DEV]: p.devCommand,
    [KEY_BRANCH]: p.defaultBranch,
    [KEY_STATUS]: p.status,
    [KEY_PM]: p.pmId
  }
}

function newBlock(project: DocProject, line = 0): Segment {
  return {
    kind: 'block',
    line,
    rawLines: [],
    project,
    layout: [{ kind: 'heading' }],
    dirty: true
  }
}

/** 새 제목 앞에 빈 줄이 하나 있도록 한다 (이미 있으면 더하지 않는다). */
function separate(segments: Segment[]): void {
  const last = segments[segments.length - 1]
  if (last === undefined) return
  const lines = last.kind === 'raw' ? last.lines : blockLines(last)
  if ((lines[lines.length - 1] ?? '') !== '') segments.push({ kind: 'raw', lines: [''] })
}

/** 기존 단일 형식을 새 블록으로 바꾼다. 원문 줄(스크립트용 키 포함)은 그대로 두고 블록을 뒤에 붙인다. */
export function materialize(doc: ProjectDoc): ProjectDoc {
  const segments = doc.segments.map((s) => ({ ...s }) as Segment)
  for (const p of doc.legacy ?? []) {
    separate(segments)
    segments.push(newBlock(p))
  }
  return { ...doc, segments, legacy: null }
}

export function addProject(doc: ProjectDoc, project: DocProject): ProjectDoc {
  const base = materialize(doc)
  separate(base.segments)
  base.segments.push(newBlock(project))
  return { ...base, trailingNewline: true }
}

/** 읽을 수 있는 블록 하나의 필드를 바꾼다. 대상이 없으면 null. */
export function patchProject(
  doc: ProjectDoc,
  id: string,
  patch: Partial<Omit<DocProject, 'id'>>
): ProjectDoc | null {
  const base = materialize(doc)
  let hit = false
  const segments = base.segments.map((s): Segment => {
    if (s.kind !== 'block' || s.project === null || s.project.id !== id) return s
    hit = true
    return { ...s, project: { ...s.project, ...patch }, dirty: true }
  })
  return hit ? { ...base, segments, trailingNewline: true } : null
}

function blockLines(s: Extract<Segment, { kind: 'block' }>): string[] {
  if (!s.dirty || s.project === null) return s.rawLines
  const values = fieldValues(s.project)
  const out: string[] = []
  const written = new Set<string>()
  let lastField = -1
  for (const item of s.layout) {
    if (item.kind === 'heading') out.push(`${PROJECT_HEADING} ${s.project.name}`)
    else if (item.kind === 'raw') out.push(item.text)
    else {
      const v = values[item.key]
      if (v !== null) {
        out.push(formatFieldLine(item.key, v))
        lastField = out.length - 1
      }
      written.add(item.key)
    }
  }
  // 사람이 쓴 블록에는 기본값(`유형: development`, `상태: active`) 줄을 새로 끼워 넣지 않는다. 새 블록은 모두 명시한다.
  const isDefault = (k: KnownKey): boolean =>
    s.rawLines.length > 0 &&
    ((k === KEY_TYPE && values[k] === 'development') ||
      (k === KEY_STATUS && values[k] === 'active'))
  const missing = CANONICAL_KEYS.filter(
    (k) => !written.has(k) && values[k] !== null && !isDefault(k)
  ).map((k) => formatFieldLine(k, values[k] as string))
  out.splice((lastField < 0 ? 0 : lastField) + 1, 0, ...missing)
  return out
}

export function serializeProjectDoc(doc: ProjectDoc): string {
  const lines: string[] = []
  for (const s of doc.segments) lines.push(...(s.kind === 'raw' ? s.lines : blockLines(s)))
  return lines.join(doc.eol) + (doc.trailingNewline || lines.length === 0 ? doc.eol : '')
}

/** 새 문서(파일이 없을 때). */
export function emptyProjectDoc(): ProjectDoc {
  return {
    eol: '\n',
    trailingNewline: true,
    segments: [{ kind: 'raw', lines: ['# 프로젝트 설정', ''] }],
    legacy: null
  }
}

/** 원문 보존 검증용: 프로젝트 필드가 아닌 모든 줄(빈 줄 제외)을 순서대로 모은다. */
export function preservedLines(doc: ProjectDoc): string[] {
  const out: string[] = []
  const keep = (l: string): void => {
    if (l.trim() !== '') out.push(l)
  }
  for (const s of doc.segments) {
    if (s.kind === 'raw') s.lines.forEach(keep)
    else if (s.project === null) s.rawLines.forEach(keep)
    else for (const item of s.layout) if (item.kind === 'raw') keep(item.text)
  }
  return out
}
