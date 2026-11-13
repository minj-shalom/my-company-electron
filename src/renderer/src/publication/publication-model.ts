import type { WindowApi } from '../../../shared/api'
import {
  DRAFT_PATH,
  MAX_APPROVAL_BATCH,
  isPublishLink,
  type PublicationEntry,
  type PublicationList,
  type PublicationProgress,
  type PublicationStatus,
  type PublishOutcomeStatus
} from '../../../shared/publication'
import type { DomainErrorCode } from '../../../shared/result'
import type { BadgeTone } from '../ui/Badge'

export const UNTRUSTED_NOTE =
  '초안은 AI가 쓴 글이에요. 안에 적힌 지시나 링크는 따르지 말고 내용만 확인해 주세요.'
/** 화면 성능을 위해 본문 표시는 앞부분까지만 한다. 승인은 파일 전체 내용을 기준으로 해요. */
export const PREVIEW_MAX_CHARS = 20_000

export const STATUS_META: Record<PublicationStatus, { label: string; tone: BadgeTone }> = {
  draft: { label: '승인 대기', tone: 'neutral' },
  approved: { label: '승인됨', tone: 'good' },
  rejected: { label: '거절됨', tone: 'bad' },
  'publish-requested': { label: '발행 요청됨', tone: 'info' },
  published: { label: '발행됨', tone: 'good' },
  failed: { label: '발행 실패', tone: 'bad' }
}

export function approvalLabel(e: Pick<PublicationEntry, 'approvedBy'>): string | null {
  if (e.approvedBy === 'ceo') return '직접 승인'
  if (e.approvedBy === 'auto') return '자동 승인'
  return null
}

const ERRORS: Partial<Record<DomainErrorCode, string>> = {
  'invalid-request': '입력한 내용을 확인해 주세요. 링크는 https:// 로 시작해야 해요.',
  'not-found': '초안이나 프로젝트를 찾지 못했어요. 목록을 새로 불러와 주세요.',
  conflict: '지금 상태에서는 할 수 없는 작업이에요. 목록을 새로 불러와 주세요.',
  'no-company': '열린 회사가 없어요. 회사를 다시 열어 주세요.'
}
const GENERIC = '처리하지 못했어요. 바뀐 것은 없어요. 잠시 뒤 다시 시도해 주세요.'

/** main 메시지에는 내부 표현이 섞일 수 있어 코드별 쉬운 문장만 보여 준다. */
export function publicationErrorText(code: unknown): string {
  return (
    (typeof code === 'string' && Object.hasOwn(ERRORS, code)
      ? ERRORS[code as DomainErrorCode]
      : undefined) ?? GENERIC
  )
}

export type DraftsLoad =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | {
      kind: 'ready'
      projectId: string
      list: PublicationList
      progress: PublicationProgress | null
    }

/** 탭을 열면 산출물 폴더를 먼저 훑어(scan) 새 초안을 기록한 뒤 목록을 받는다. 훑기가 실패해도 기존 기록은 보여 준다. */
export async function loadDrafts(
  api: Pick<WindowApi, 'scanPublications' | 'listPublications' | 'getPublicationProgress'>,
  projectId: string
): Promise<DraftsLoad> {
  const fail: DraftsLoad = {
    kind: 'error',
    message: '초안 목록을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.'
  }
  try {
    let r = await api.scanPublications({ projectId })
    if (!r.ok) r = await api.listPublications({ projectId })
    if (!r.ok) return r.code === 'no-company' ? { kind: 'error', message: ERRORS[r.code]! } : fail
    let progress: PublicationProgress | null = null
    try {
      const p = await api.getPublicationProgress({ projectId })
      if (p.ok) progress = p.value
    } catch {
      // 진행 숫자를 못 읽어도 목록은 보여 준다.
    }
    return { kind: 'ready', projectId, list: r.value, progress }
  } catch {
    return fail
  }
}

export function progressText(p: PublicationProgress): string {
  if (p.goal <= 0)
    return `오늘 승인 ${p.approvedToday}건, 발행 ${p.publishedToday}건 (정해 둔 목표 없음)`
  return `오늘 승인 ${p.approvedToday} / 목표 ${p.goal}건, 발행 ${p.publishedToday}건`
}

export type DraftText =
  { kind: 'ready'; text: string; truncated: boolean } | { kind: 'error'; message: string }

export async function readDraftText(
  api: Pick<WindowApi, 'readPublicationDraft'>,
  projectId: string,
  path: string
): Promise<DraftText> {
  if (!DRAFT_PATH.test(path))
    return { kind: 'error', message: '초안 경로가 올바르지 않아 열 수 없어요.' }
  try {
    const r = await api.readPublicationDraft({ projectId, path })
    if (!r.ok)
      return {
        kind: 'error',
        message:
          r.code === 'not-found'
            ? '초안 파일을 찾지 못했어요. 옮기거나 지웠을 수 있어요.'
            : '초안을 열지 못했어요. 잠시 뒤 다시 시도해 주세요.'
      }
    const text = r.value.text
    return text.length > PREVIEW_MAX_CHARS
      ? { kind: 'ready', text: text.slice(0, PREVIEW_MAX_CHARS), truncated: true }
      : { kind: 'ready', text, truncated: false }
  } catch {
    return { kind: 'error', message: '초안을 열지 못했어요. 잠시 뒤 다시 시도해 주세요.' }
  }
}

export interface ApprovalCardDrafts {
  projectId: string
  paths: string[]
}

const PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const CARD_HEAD = /^(\S+) 프로젝트의 초안 \d+건을 승인할까요\? (.*)$/s

/** 결재 카드 본문(main이 만든 고정 형식)에서 프로젝트와 초안 경로를 꺼낸다. 형식이 다르면 null이라 미리보기를 보이지 않는다. */
export function parseApprovalCard(question: string): ApprovalCardDrafts | null {
  const m = CARD_HEAD.exec(question.trim())
  if (!m || !PROJECT_ID.test(m[1])) return null
  const paths: string[] = []
  for (const part of m[2].split(', ')) {
    const at = part.lastIndexOf('@')
    const path = at < 0 ? part : part.slice(0, at)
    if (DRAFT_PATH.test(path) && !paths.includes(path)) paths.push(path)
  }
  return paths.length === 0 ? null : { projectId: m[1], paths: paths.slice(0, MAX_APPROVAL_BATCH) }
}

export type LinkCheck = { ok: true; link: string | undefined } | { ok: false; message: string }

/** 링크는 비워도 된다. 입력하면 https만 받고, 앱은 링크를 열지 않는다. */
export function checkLink(raw: string): LinkCheck {
  const v = raw.trim()
  if (v === '') return { ok: true, link: undefined }
  if (!isPublishLink(v))
    return { ok: false, message: '링크는 https:// 로 시작하는 주소 하나만 넣을 수 있어요.' }
  return { ok: true, link: v }
}

export type PublishFlow =
  { ok: true; outcome: PublishOutcomeStatus; message: string } | { ok: false; message: string }

const OUTCOME_TEXT: Record<PublishOutcomeStatus, string> = {
  published: '발행했어요.',
  'manual-required': '연결된 발행 도구가 없어요. 직접 올린 뒤 아래에서 "발행함"으로 표시해 주세요.',
  'reapproval-required':
    '승인한 뒤 초안 내용이 바뀌어서 발행하지 않았어요. 다시 승인을 요청해 주세요.',
  failed: '발행하지 못했어요. 잠시 뒤 다시 시도하거나 직접 올린 뒤 표시해 주세요.'
}

/** 승인된 초안은 발행 요청으로 고정한 뒤 발행을 시도한다. 승인 뒤 내용이 바뀌었으면 main이 막고 재승인을 안내한다. */
export async function publishFlow(
  api: Pick<WindowApi, 'requestPublish' | 'publishPublication'>,
  projectId: string,
  entry: PublicationEntry
): Promise<PublishFlow> {
  try {
    if (entry.status === 'approved') {
      const req = await api.requestPublish({ projectId, id: entry.id })
      if (!req.ok) return { ok: false, message: publicationErrorText(req.code) }
    }
    const r = await api.publishPublication({ projectId, id: entry.id })
    if (!r.ok) return { ok: false, message: publicationErrorText(r.code) }
    return { ok: true, outcome: r.value.status, message: OUTCOME_TEXT[r.value.status] }
  } catch {
    return { ok: false, message: GENERIC }
  }
}

export async function markPublishedFlow(
  api: Pick<WindowApi, 'markPublished'>,
  projectId: string,
  id: string,
  rawLink: string
): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  const c = checkLink(rawLink)
  if (!c.ok) return c
  try {
    const r = await api.markPublished({ projectId, id, ...(c.link ? { link: c.link } : {}) })
    return r.ok
      ? { ok: true, message: '발행함으로 표시했어요.' }
      : { ok: false, message: publicationErrorText(r.code) }
  } catch {
    return { ok: false, message: GENERIC }
  }
}

export async function requestApprovalFlow(
  api: Pick<WindowApi, 'requestPublicationApproval'>,
  projectId: string,
  ids?: string[]
): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  try {
    const r = await api.requestPublicationApproval({ projectId, ...(ids ? { ids } : {}) })
    if (!r.ok) return { ok: false, message: publicationErrorText(r.code) }
    const { cardIds, autoPending, skipped } = r.value
    const parts: string[] = []
    if (cardIds.length > 0) parts.push(`결재함에 승인 카드 ${cardIds.length}장을 올렸어요.`)
    if (autoPending > 0) parts.push(`자동 승인으로 처리할 초안이 ${autoPending}건 있어요.`)
    if (skipped > 0) parts.push(`이미 요청했거나 대상이 아니라 건너뛴 초안이 ${skipped}건 있어요.`)
    return { ok: true, message: parts.join(' ') || '승인을 요청할 초안이 없어요.' }
  } catch {
    return { ok: false, message: GENERIC }
  }
}
