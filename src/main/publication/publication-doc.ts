import { createHash } from 'node:crypto'
import { TICKET_ID } from '../repository/ids'
import { DECISION_ID } from '../repository/ids'
import { hasForbiddenChar } from '../../shared/project'
import {
  APPROVAL_METHODS,
  DRAFT_PATH,
  MAX_PUBLICATION_ENTRIES,
  MAX_REASON,
  PUBLICATION_STATUSES,
  isPublishLink,
  type PublicationEntry
} from '../../shared/publication'

/** `company/publishing/<프로젝트 id>.md`의 순수 파서·직렬화기 (파일 접근 없음). */
export const publishingFile = (projectId: string): string => `company/publishing/${projectId}.md`

const MAX_TITLE = 200
const HEADING = /^##[ \t]+(\d{4}-\d{2}-\d{2})[ \t]+(\S+)[ \t]*$/
const ANY_H2 = /^##[ \t]/
const FIELD =
  /^[-*][ \t]+(제목|상태|해시|승인 일시|승인 방식|요청 일시|발행 일시|링크|티켓|카드|메모):[ \t]*(.*?)[ \t]*$/
const ISO = /^\d{4}-\d{2}-\d{2}T[0-9:.]+Z$/
const SHA256 = /^[0-9a-f]{64}$/

export const DEFAULT_PREFACE = [
  '# 발행 기록',
  '',
  '> 앱이 쓰는 파일이다. 직접 고치지 않는다 (앱 밖에서 바뀌면 무결성 감지가 경고한다).',
  '> 항목은 `## <날짜> <산출물 상대 경로>`이고 같은 날짜·경로는 하나만 둔다. 상태: draft, approved, rejected, publish-requested, published, failed.'
].join('\n')

export const entryId = (date: string, path: string): string =>
  createHash('sha256').update(`${date}|${path}`).digest('hex').slice(0, 12)

export type LayoutEntry = { raw: string } | { id: string; extra: string[] }

export interface ParsedPublishing {
  preface: string
  entries: PublicationEntry[]
  unreadable: number
  layout: LayoutEntry[]
}

const oneLine = (v: string, max: number): boolean =>
  v.length > 0 && [...v].length <= max && !hasForbiddenChar(v)

/** 한 줄 값으로 만든다 (제어 문자 제거, 공백 정리, 길이 제한). */
export function cleanLine(v: string, max: number): string {
  let out = ''
  for (const ch of v) out += hasForbiddenChar(ch) ? ' ' : ch
  return [...out.replace(/\s+/g, ' ').trim()].slice(0, max).join('')
}

function parseBlock(date: string, path: string, lines: string[]): PublicationEntry | null {
  if (!DRAFT_PATH.test(path) || path.includes('..') || path.includes('//')) return null
  const f = new Map<string, string[]>()
  for (const line of lines) {
    const m = FIELD.exec(line)
    if (m) f.set(m[1], [...(f.get(m[1]) ?? []), m[2]])
  }
  const one = (k: string): string | null => {
    const v = f.get(k)
    return v !== undefined && v.length === 1 && v[0] !== '' ? v[0] : null
  }
  const dup = [...f.values()].some((v) => v.length > 1)
  const title = one('제목')
  const status = PUBLICATION_STATUSES.find((s) => s === one('상태'))
  const hash = one('해시')
  const approvedAt = one('승인 일시')
  const method = APPROVAL_METHODS.find((m) => m === one('승인 방식')) ?? null
  const requestedAt = one('요청 일시')
  const publishedAt = one('발행 일시')
  const link = one('링크')
  const ticket = one('티켓')
  const card = one('카드')
  const note = one('메모')
  if (
    dup ||
    title === null ||
    !oneLine(title, MAX_TITLE) ||
    status === undefined ||
    hash === null ||
    !SHA256.test(hash) ||
    (approvedAt !== null && !ISO.test(approvedAt)) ||
    (requestedAt !== null && !ISO.test(requestedAt)) ||
    (publishedAt !== null && !ISO.test(publishedAt)) ||
    (one('승인 방식') !== null && method === null) ||
    (link !== null && !isPublishLink(link)) ||
    (ticket !== null && !TICKET_ID.test(ticket)) ||
    (card !== null && !DECISION_ID.test(card)) ||
    (note !== null && !oneLine(note, MAX_REASON))
  )
    return null
  // 승인 근거 없이 승인 이후 상태일 수 없다 (손으로 `published`를 쓴 기록은 읽을 수 없는 블록으로 보존한다).
  const needsApproval =
    status === 'approved' || status === 'publish-requested' || status === 'published'
  if (needsApproval && (approvedAt === null || method === null)) return null
  if (status === 'published' && publishedAt === null) return null
  return {
    id: entryId(date, path),
    date,
    title,
    path,
    hash,
    status,
    approvedAt,
    approvedBy: method,
    requestedAt,
    publishedAt,
    link,
    ticketId: ticket,
    cardId: card,
    note
  }
}

export function parsePublishing(text: string | null): ParsedPublishing {
  if (text === null) return { preface: DEFAULT_PREFACE, entries: [], unreadable: 0, layout: [] }
  const lines = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).split(/\r?\n/)
  const first = lines.findIndex((l) => HEADING.test(l))
  const preface = (first < 0 ? lines : lines.slice(0, first)).join('\n').trimEnd()
  const entries: PublicationEntry[] = []
  const layout: LayoutEntry[] = []
  const seen = new Set<string>()
  let unreadable = 0
  let blocks = 0
  let i = first < 0 ? lines.length : first
  while (i < lines.length) {
    let end = i + 1
    while (end < lines.length && !ANY_H2.test(lines[end])) end++
    const section = lines.slice(i, end)
    const h = HEADING.exec(lines[i])
    if (!h) {
      layout.push({ raw: section.join('\n').trimEnd() })
      i = end
      continue
    }
    blocks++
    const body = section.slice(1)
    const e = blocks > MAX_PUBLICATION_ENTRIES ? null : parseBlock(h[1], h[2], body)
    // 같은 날짜·경로가 둘이면 먼저 나온 것만 쓴다 (중복 기록 방지).
    if (e === null || seen.has(e.id)) {
      unreadable++
      layout.push({ raw: section.join('\n').trimEnd() })
    } else {
      seen.add(e.id)
      entries.push(e)
      layout.push({ id: e.id, extra: body.filter((l) => l.trim() !== '' && !FIELD.test(l)) })
    }
    i = end
  }
  return {
    preface: preface === '' ? DEFAULT_PREFACE : preface,
    entries,
    unreadable,
    layout
  }
}

const renderBlock = (e: PublicationEntry, extra: string[]): string =>
  [
    `## ${e.date} ${e.path}`,
    `- 제목: ${e.title}`,
    `- 상태: ${e.status}`,
    `- 해시: ${e.hash}`,
    ...(e.approvedAt ? [`- 승인 일시: ${e.approvedAt}`] : []),
    ...(e.approvedBy ? [`- 승인 방식: ${e.approvedBy}`] : []),
    ...(e.requestedAt ? [`- 요청 일시: ${e.requestedAt}`] : []),
    ...(e.publishedAt ? [`- 발행 일시: ${e.publishedAt}`] : []),
    ...(e.link ? [`- 링크: ${e.link}`] : []),
    ...(e.ticketId ? [`- 티켓: ${e.ticketId}`] : []),
    ...(e.cardId ? [`- 카드: ${e.cardId}`] : []),
    ...(e.note ? [`- 메모: ${e.note}`] : []),
    ...extra
  ].join('\n')

/** 기존 구역 순서(`layout`)를 지키고(읽을 수 없는 블록은 원문 그대로), 새 항목은 끝에 붙인다. */
export function serializePublishing(
  preface: string,
  entries: PublicationEntry[],
  layout: LayoutEntry[] = []
): string {
  const byId = new Map(entries.map((e) => [e.id, e]))
  const used = new Set<string>()
  const parts: string[] = []
  for (const l of layout) {
    if ('raw' in l) parts.push(l.raw)
    else {
      const e = byId.get(l.id)
      if (e === undefined) continue
      used.add(e.id)
      parts.push(renderBlock(e, l.extra))
    }
  }
  for (const e of entries) if (!used.has(e.id)) parts.push(renderBlock(e, []))
  return [preface.trimEnd(), ...parts].join('\n\n').trimEnd() + '\n'
}
