import { isAbsolute, relative, sep } from 'node:path'
import type { RefreshKind } from './cached-repository'

/**
 * 회사 폴더 기준 상대 경로(`/` 구분)가 어떤 캐시 종류에 영향을 주는지.
 * 폴더 이름만 보고 판단하며 파일 내용은 보지 않는다. 관심 밖이면 null.
 */
export function classifyPath(rel: string): RefreshKind | null {
  const parts = rel.split('/').filter(Boolean)
  const [a, b, c, d] = parts
  if (a === '.claude' && b === 'agents')
    return parts.length <= 3 && isMdOrDir(c, 3, parts) ? 'org' : null
  if (a !== 'company') return null
  if (b === 'org.md' && parts.length === 2) return 'org'
  if (b === 'reports') return parts.length <= 3 && isMdOrDir(c, 3, parts) ? 'report' : null
  if (b === 'tickets' || b === 'decisions') {
    const kind = b === 'tickets' ? 'ticket' : 'decision'
    const allowed = b === 'tickets' ? ['backlog', 'in-progress', 'done'] : ['pending', 'done']
    if (parts.length === 2) return kind
    if (!allowed.includes(c)) return null
    if (parts.length === 3) return kind
    return parts.length === 4 && d.endsWith('.md') ? kind : null
  }
  return null
}

/** 길이가 `fileDepth`인 경로는 `.md` 파일이어야 하고, 더 짧으면 디렉터리 자체의 변화로 본다. */
function isMdOrDir(name: string | undefined, fileDepth: number, parts: string[]): boolean {
  if (parts.length < fileDepth) return true
  return name !== undefined && name.endsWith('.md')
}

/** 절대 경로를 root 기준 상대 경로로. root 밖이면 null (심볼릭 링크로 밖을 가리키는 이벤트 포함). */
export function relativeInside(root: string, abs: string): string | null {
  const rel = relative(root, abs)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return rel === '' ? '' : null
  return rel.split(sep).join('/')
}
