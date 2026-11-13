import { isToolsExpansion, readTools } from '../employee/agent-file'
import { splitFrontmatter } from '../repository/markdown'
import type { OrgMember } from '../../shared/org'
import { DELETED_HASH, ORG, agentIdOf, isAgentPath, type FileMap } from './protected-files'
import { orgModelOf } from './validators'

/** 보호 직원: 이 파일과 `org.md` 행은 hr이 쓸 수 없고 변경은 제안·승인을 거쳐야 한다. COO는 메인 세션 행으로 식별한다. */
export const PROTECTED_AGENTS: ReadonlySet<string> = new Set(['cto', 'cfo', 'hr'])

export type SensitiveKind = 'protected-edit' | 'employee-removal' | 'tools-expansion'

export interface SensitiveChange {
  kind: SensitiveKind
  /** 승인 해시를 비교할 파일과 변경 후 해시 (삭제는 `DELETED_HASH`). */
  file: string
  hash: string
  /** 격리할 직원 id. COO 행처럼 직원 파일이 없으면 null. */
  employeeId: string | null
}

const isProtectedMember = (m: OrgMember): boolean =>
  m.kind === 'main-session' || (m.agentId !== null && PROTECTED_AGENTS.has(m.agentId))

interface ToolsInfo {
  present: boolean
  list: string[]
}

function toolsOf(text: string | null | undefined): ToolsInfo | null | undefined {
  if (text === undefined) return undefined // 파일 없음
  if (text === null) return null // 읽을 수 없음
  try {
    const { data } = splitFrontmatter(text)
    return { present: 'tools' in data, list: readTools(data.tools) }
  } catch {
    return null
  }
}

/** `tools` 키가 없으면 모든 도구를 상속한다. 새 파일에서 키가 없는 것도 확대로 본다. */
function expands(
  before: ToolsInfo | null | undefined,
  after: ToolsInfo | null | undefined
): boolean {
  if (after === undefined || after === null) return false
  if (before === null) return false
  if (before === undefined) return !after.present || isToolsExpansion([], after.list)
  if (!before.present) return false
  if (!after.present) return true
  return isToolsExpansion(before.list, after.list)
}

const sameRow = (a: OrgMember, b: OrgMember): boolean =>
  a.title === b.title &&
  a.kind === b.kind &&
  a.agentId === b.agentId &&
  a.department === b.department &&
  a.reportsTo === b.reportsTo &&
  a.role === b.role

/**
 * 민감 변경 판정(설계 4절): ① COO·CTO·CFO·hr 자신의 파일 또는 org 행 수정·삭제 ② 직원 삭제
 * ③ tools에 Bash 추가나 쓰기 도구 범위 확대. 승인 여부는 호출자가 승인 레코드와 비교한다.
 */
export function judgeSensitive(before: FileMap, after: FileMap): SensitiveChange[] {
  const out: SensitiveChange[] = []
  const rels = new Set([...before.keys(), ...after.keys()].filter(isAgentPath))
  for (const rel of [...rels].sort()) {
    const b = before.get(rel)
    const a = after.get(rel)
    if (b?.hash === a?.hash) continue
    const id = agentIdOf(rel)
    const hash = a?.hash ?? DELETED_HASH
    if (PROTECTED_AGENTS.has(id))
      out.push({ kind: 'protected-edit', file: rel, hash, employeeId: id })
    if (a === undefined) out.push({ kind: 'employee-removal', file: rel, hash, employeeId: id })
    else if (expands(toolsOf(b?.text), toolsOf(a.text)))
      out.push({ kind: 'tools-expansion', file: rel, hash, employeeId: id })
  }

  const orgBefore = orgModelOf(before)
  const orgAfter = orgModelOf(after)
  const orgHash = after.get(ORG)?.hash
  if (orgBefore !== null && orgHash !== undefined && orgHash !== before.get(ORG)?.hash) {
    const now = new Map((orgAfter?.members ?? []).map((m) => [m.title, m]))
    for (const m of orgBefore.members) {
      const n = now.get(m.title)
      const removed = n === undefined
      if (isProtectedMember(m) && (removed || !sameRow(m, n)))
        out.push({ kind: 'protected-edit', file: ORG, hash: orgHash, employeeId: m.agentId })
      if (removed && m.kind === 'agent')
        out.push({ kind: 'employee-removal', file: ORG, hash: orgHash, employeeId: m.agentId })
    }
  }
  return out
}
