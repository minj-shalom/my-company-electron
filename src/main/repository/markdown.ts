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
    if (/^[ \t]*(```|~~~)/.test(line)) fence = !fence
    if (fence) continue
    const m = /^#[ \t]+(\S.*)$/.exec(line.trimEnd())
    if (m) return m[1].replace(/[ \t]+#+$/, '')
  }
  return null
}

/**
 * `- **키:** 값` 형식의 메타 줄에서 값을 읽는다. 첫 일치.
 * `m` 플래그 정규식 대신 줄 단위로 훑는다: `\s`가 개행을 삼켜 공백/빈 줄만 이어진 큰 파일에서 O(n²)가 되고,
 * 단독 `\r`이 줄 경계로 취급되어 줄을 위조할 수 있기 때문이다 (줄 경계는 `\n`, `\r\n`만).
 */
export function metaValue(body: string, key: string): string | null {
  const re = new RegExp(`^[ \\t]*[-*][ \\t]+\\*\\*${escapeRe(key)}:\\*\\*[ \\t]*(.*)$`)
  for (const line of body.split(/\r?\n/)) {
    const m = re.exec(line)
    if (m) return m[1].trim()
  }
  return null
}

/** `- 라벨: 값` 불릿 줄에서 값을 읽는다 (콜론은 `:` 또는 `：`). 첫 일치. */
export function bulletValue(text: string, label: string): string | null {
  const re = new RegExp(`^[ \\t]*[-*][ \\t]+${escapeRe(label)}[ \\t]*[:：][ \\t]*(.*)$`)
  for (const line of text.split(/\r?\n/)) {
    const m = re.exec(line)
    if (m) return m[1].trim()
  }
  return null
}

/** `## 제목` 아래 본문(다음 `##` 전까지). 제목은 접두어 일치. 코드 펜스를 존중한다. */
export function section(body: string, headingPrefix: string): string | null {
  return sectionWhere(body, (title) => title.startsWith(headingPrefix))
}

/** 제목 문자열 조건으로 섹션을 찾는다. `section`의 접두어 일치가 `## 결정 근거` 같은 제목까지 잡는 것을 피할 때 쓴다. */
export function sectionWhere(body: string, matchTitle: (title: string) => boolean): string | null {
  const lines = body.split(/\r?\n/)
  let fence = false
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^[ \t]*(```|~~~)/.test(line)) fence = !fence
    if (fence) continue
    if (start < 0) {
      const m = /^##[ \t]+(\S.*)$/.exec(line.trimEnd())
      if (m && matchTitle(m[1])) start = i + 1
    } else if (/^##[ \t]/.test(line)) {
      return lines.slice(start, i).join('\n').trim()
    }
  }
  return start < 0 ? null : lines.slice(start).join('\n').trim()
}

export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
