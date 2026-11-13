import { PROJECT_ID } from '../../shared/project'
import {
  DRAFT_PATH,
  ENTRY_ID,
  MAX_APPROVAL_BATCH,
  MAX_LINK,
  isPublishLink
} from '../../shared/publication'
import { TICKET_ID } from '../repository/ids'

type Parsed<T> = { ok: true; value: T } | { ok: false; message: string }

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const bad = (message: string): { ok: false; message: string } => ({ ok: false, message })

/** 허용된 키만 받는다 (추가 필드 거부). */
function record(raw: unknown, allowed: string[]): Record<string, unknown> | null {
  if (!isRecord(raw) || Object.keys(raw).some((k) => !allowed.includes(k))) return null
  return raw
}

const projectIdOf = (v: unknown): string | null =>
  typeof v === 'string' && PROJECT_ID.test(v) ? v : null

export function parseProject(raw: unknown): Parsed<{ projectId: string }> {
  const r = record(raw, ['projectId'])
  const projectId = r && projectIdOf(r.projectId)
  return projectId ? { ok: true, value: { projectId } } : bad('요청이 올바르지 않습니다.')
}

export function parseRead(raw: unknown): Parsed<{ projectId: string; path: string }> {
  const r = record(raw, ['projectId', 'path'])
  const projectId = r && projectIdOf(r.projectId)
  if (!r || !projectId || typeof r.path !== 'string' || !DRAFT_PATH.test(r.path))
    return bad('요청이 올바르지 않습니다.')
  if (r.path.includes('..') || r.path.includes('//')) return bad('초안 경로가 올바르지 않습니다.')
  return { ok: true, value: { projectId, path: r.path } }
}

export function parseItem(raw: unknown): Parsed<{ projectId: string; id: string }> {
  const r = record(raw, ['projectId', 'id'])
  const projectId = r && projectIdOf(r.projectId)
  if (!r || !projectId || typeof r.id !== 'string' || !ENTRY_ID.test(r.id))
    return bad('요청이 올바르지 않습니다.')
  return { ok: true, value: { projectId, id: r.id } }
}

export function parseMarkPublished(
  raw: unknown
): Parsed<{ projectId: string; id: string; link: string | null }> {
  const r = record(raw, ['projectId', 'id', 'link'])
  const item = parseItem(r && { projectId: r.projectId, id: r.id })
  if (!r || !item.ok) return bad('요청이 올바르지 않습니다.')
  let link: string | null = null
  if (r.link !== undefined && r.link !== null && r.link !== '') {
    if (typeof r.link !== 'string' || r.link.length > MAX_LINK || !isPublishLink(r.link))
      return bad('게시 링크는 https:// 주소만 입력할 수 있습니다.')
    link = r.link
  }
  return { ok: true, value: { ...item.value, link } }
}

export function parseRequestApproval(
  raw: unknown
): Parsed<{ projectId: string; ids: string[] | null; ticketId: string | null }> {
  const r = record(raw, ['projectId', 'ids', 'ticketId'])
  const projectId = r && projectIdOf(r.projectId)
  if (!r || !projectId) return bad('요청이 올바르지 않습니다.')
  let ids: string[] | null = null
  if (r.ids !== undefined) {
    if (
      !Array.isArray(r.ids) ||
      r.ids.length === 0 ||
      r.ids.length > MAX_APPROVAL_BATCH ||
      !r.ids.every((i) => typeof i === 'string' && ENTRY_ID.test(i))
    )
      return bad('항목 목록이 올바르지 않습니다.')
    ids = [...new Set(r.ids as string[])]
  }
  let ticketId: string | null = null
  if (r.ticketId !== undefined) {
    if (typeof r.ticketId !== 'string' || !TICKET_ID.test(r.ticketId))
      return bad('티켓 번호가 올바르지 않습니다.')
    ticketId = r.ticketId
  }
  return { ok: true, value: { projectId, ids, ticketId } }
}
