import { parse as parseYaml } from 'yaml'

export interface FrontmatterResult {
  data: Record<string, unknown>
  body: string
}

const FRONTMATTER = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/

/**
 * 맨 앞의 YAML frontmatter를 분리한다. 없으면 data는 빈 객체.
 * 잘못된 YAML이거나 매핑이 아니면 예외를 던진다 (호출자가 오류 항목으로 바꾼다).
 */
export function splitFrontmatter(text: string): FrontmatterResult {
  const src = text.replace(/^\uFEFF/, '')
  const m = FRONTMATTER.exec(src)
  if (!m) return { data: {}, body: src }
  // maxAliasCount: 별칭 폭탄(YAML bomb) 방지. yaml 기본 스키마는 코드 실행 태그를 지원하지 않는다.
  const parsed: unknown = parseYaml(m[1], { maxAliasCount: 10, logLevel: 'error' })
  if (parsed === null || parsed === undefined) return { data: {}, body: src.slice(m[0].length) }
  if (typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('frontmatter는 key: value 형태여야 합니다.')
  return { data: parsed as Record<string, unknown>, body: src.slice(m[0].length) }
}

export function asString(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() || null
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return null
}

/** 첫 `# 제목` 줄. 코드 펜스 안은 무시한다. */
export function firstHeading(body: string): string | null {
  let fence = false
  for (const line of body.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence
    if (fence) continue
    const m = /^#\s+(.+?)\s*#*\s*$/.exec(line)
    if (m) return m[1]
  }
  return null
}

/** `- **키:** 값` 형식의 메타 줄에서 값을 읽는다. 첫 H1 이전~전체에서 첫 일치. */
export function metaValue(body: string, key: string): string | null {
  const re = new RegExp(`^\\s*[-*]\\s+\\*\\*${escapeRe(key)}:\\*\\*[ \\t]*(.*)$`, 'm')
  const m = re.exec(body)
  return m ? m[1].trim() : null
}

/** `## 제목` 아래 본문(다음 `##` 전까지). 제목은 접두어 일치. 코드 펜스를 존중한다. */
export function section(body: string, headingPrefix: string): string | null {
  const lines = body.split(/\r?\n/)
  let fence = false
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s*(```|~~~)/.test(line)) fence = !fence
    if (fence) continue
    if (start < 0) {
      const m = /^##\s+(.+?)\s*$/.exec(line)
      if (m && m[1].startsWith(headingPrefix)) start = i + 1
    } else if (/^##\s+/.test(line)) {
      return lines.slice(start, i).join('\n').trim()
    }
  }
  return start < 0 ? null : lines.slice(start).join('\n').trim()
}

export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
