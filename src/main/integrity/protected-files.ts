import { createHash } from 'node:crypto'
import { FsGuardError, type SafeFs } from '../repository/safe-fs'

export const AGENTS = '.claude/agents'
export const ORG = 'company/org.md'
export const PROJECT = 'company/project.md'
/** 반복 업무 정의(T-049). 앱(CEO UI)만 쓴다: LLM이 정의를 바꿔 티켓을 대량 생성하지 못하게 정책 파일처럼 감지한다. */
export const RECURRING = 'company/recurring.md'
const ARCHIVE = 'company/archive'
const POLICIES = 'company/policies'
const MAX_DEPTH = 3
const MAX_FILES = 400

/**
 * 변경을 감시하고 스냅샷하는 파일 집합.
 * 직원 파일, org.md, project.md, archive는 설계 2절의 보호 대상이고 `company/policies/**`는 활성화 기록 무서명 보완용 감지 대상이다.
 */
export function isProtectedPath(rel: string): boolean {
  if (rel.includes('\\') || rel.includes('\0') || rel.split('/').includes('..')) return false
  if (rel === ORG || rel === PROJECT || rel === RECURRING) return true
  if (!rel.endsWith('.md')) return false
  const depth = rel.split('/').length
  if (rel.startsWith(`${AGENTS}/`)) return depth === 3
  return (rel.startsWith(`${ARCHIVE}/`) || rel.startsWith(`${POLICIES}/`)) && depth <= MAX_DEPTH + 3
}

export const isPolicyPath = (rel: string): boolean => rel.startsWith(`${POLICIES}/`)
/** 앱 밖에서 바뀌면 되돌리기 카드를 만드는 파일 (정책, 반복 업무 정의). */
export const isAppOnlyPath = (rel: string): boolean => isPolicyPath(rel) || rel === RECURRING
export const isAgentPath = (rel: string): boolean =>
  rel.startsWith(`${AGENTS}/`) && rel.endsWith('.md')
export const agentIdOf = (rel: string): string => rel.slice(AGENTS.length + 1, -3)

/** `text`가 null이면 읽을 수 없는 파일(크기 상한 초과, 링크 등)이다. 해시는 그래도 상태를 구분한다. */
export interface FileState {
  text: string | null
  hash: string
}
export type FileMap = Map<string, FileState>

export const sha256 = (v: string): string => createHash('sha256').update(v, 'utf8').digest('hex')
export const DELETED_HASH = 'deleted'
const UNREADABLE = (kind: string): string => `unreadable:${kind}`

async function walk(fs: SafeFs, dir: string, depth: number, out: string[]): Promise<void> {
  if (depth > MAX_DEPTH || out.length >= MAX_FILES) return
  const { files } = await fs.listMarkdown(dir)
  for (const f of files) if (out.length < MAX_FILES) out.push(`${dir}/${f}`)
  for (const d of await fs.listDirs(dir)) await walk(fs, `${dir}/${d}`, depth + 1, out)
}

/** 보호 대상 파일을 모두 읽는다. 없는 파일은 맵에 없다. */
export async function readProtectedFiles(fs: SafeFs): Promise<FileMap> {
  const rels: string[] = [ORG, PROJECT, RECURRING]
  await walk(fs, AGENTS, MAX_DEPTH, rels)
  await walk(fs, ARCHIVE, 0, rels)
  await walk(fs, POLICIES, 0, rels)
  const map: FileMap = new Map()
  for (const rel of rels) {
    if (!isProtectedPath(rel)) continue
    try {
      const text = await fs.readText(rel)
      map.set(rel, { text, hash: sha256(text) })
    } catch (e) {
      if (!(e instanceof FsGuardError)) throw e
      if (e.kind !== 'missing') map.set(rel, { text: null, hash: UNREADABLE(e.kind) })
    }
  }
  return map
}

/** 변경된 파일 이름. 추가, 삭제, 해시 변경을 모두 포함한다. */
export function diffMaps(
  before: ReadonlyMap<string, { hash: string }>,
  after: ReadonlyMap<string, { hash: string }>
): string[] {
  const out: string[] = []
  for (const [k, v] of after) if (before.get(k)?.hash !== v.hash) out.push(k)
  for (const k of before.keys()) if (!after.has(k)) out.push(k)
  return out.sort()
}

// 자격 증명처럼 보이는 문자열. 모든 패턴은 길이가 제한된 문자 클래스라 선형이다.
const SECRET_PATTERNS: readonly RegExp[] = [
  /-----BEGIN [A-Z ]{0,30}PRIVATE KEY-----/,
  /\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}/,
  /\bsk-[A-Za-z0-9_-]{20,}/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  /\b(?:api[_-]?key|secret|token|password|passwd)["']?\s*[:=]\s*["']?[A-Za-z0-9_/+=-]{24,}/i
]

export function containsSecret(text: string): boolean {
  return SECRET_PATTERNS.some((p) => p.test(text))
}

/** 비밀 패턴이 있는 파일 이름 (내용은 돌려주지 않는다). */
export function filesWithSecrets(files: ReadonlyMap<string, FileState>): string[] {
  const out: string[] = []
  for (const [k, v] of files) if (v.text !== null && containsSecret(v.text)) out.push(k)
  return out.sort()
}
