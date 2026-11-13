/** 산출물·발행 기록(T-050) 계약. 원본은 회사 폴더의 `company/publishing/<프로젝트 id>.md`이고 이 구조는 파생물이다. */

export const PUBLICATION_STATUSES = [
  'draft',
  'approved',
  'rejected',
  'publish-requested',
  'published',
  'failed'
] as const
export type PublicationStatus = (typeof PUBLICATION_STATUSES)[number]

export const APPROVAL_METHODS = ['ceo', 'auto'] as const
export type ApprovalMethod = (typeof APPROVAL_METHODS)[number]

/** 산출물 폴더 기준 상대 경로. `.md` 파일만 다룬다. */
export const DRAFT_PATH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}\.md$/
export const MAX_DRAFT_BYTES = 1024 * 1024
export const MAX_PUBLICATION_ENTRIES = 500
export const MAX_REASON = 500
export const MAX_LINK = 500
/** 한 번에 승인 요청할 수 있는 초안 수. */
export const MAX_APPROVAL_BATCH = 20
export const ENTRY_ID = /^[0-9a-f]{12}$/

/** 게시 링크는 `https://`만 저장·표시한다. 앱은 이 링크를 열거나 접속하지 않는다. */
export function isPublishLink(v: string): boolean {
  if (v.length > MAX_LINK || /[\s<>"'`\\]/.test(v)) return false
  try {
    const u = new URL(v)
    return u.protocol === 'https:' && u.username === '' && u.password === '' && u.host !== ''
  } catch {
    return false
  }
}

export interface PublicationEntry {
  /** 날짜와 경로에서 만든 안정 식별자 (12자리 hex). 요청에서 항목을 가리킬 때 쓴다. */
  id: string
  /** 기록을 만든 날짜 (YYYY-MM-DD). 같은 날짜·경로 항목은 하나만 있다. */
  date: string
  title: string
  /** 산출물 폴더 기준 상대 경로. */
  path: string
  /** 내용 SHA-256 (64자리 hex). 승인 시점에 고정된다. */
  hash: string
  status: PublicationStatus
  /** ISO 8601. 승인되지 않았으면 null. */
  approvedAt: string | null
  approvedBy: ApprovalMethod | null
  /** 발행 요청 시각. */
  requestedAt: string | null
  publishedAt: string | null
  /** 게시 링크(텍스트). */
  link: string | null
  ticketId: string | null
  /** 승인을 묻는 `content-approval` 카드 번호. */
  cardId: string | null
  /** 거절 사유 또는 실패·재승인 안내. */
  note: string | null
}

export interface PublicationList {
  projectId: string
  items: PublicationEntry[]
  /** 읽지 못해 보존만 하는 블록 수. 0보다 크면 앱 쓰기가 거부된다. */
  unreadable: number
}

export interface PublicationProjectRequest {
  projectId: string
}

export interface PublicationReadRequest {
  projectId: string
  /** 산출물 폴더 기준 상대 경로. */
  path: string
}

export interface PublicationDraftContent {
  path: string
  hash: string
  size: number
  /** 신뢰할 수 없는 텍스트다 (프롬프트 주입으로 만들어졌을 수 있다). renderer는 평문 또는 sanitize 후 렌더링한다. */
  text: string
}

export interface PublicationItemRequest {
  projectId: string
  id: string
}

export interface PublicationRequestApprovalRequest {
  projectId: string
  /** 비우면 승인 대기 중인 `draft` 전부(최대 `MAX_APPROVAL_BATCH`). */
  ids?: string[]
  ticketId?: string
}

export interface PublicationRequestApprovalResult {
  /** 이번에 새로 만든 카드 번호. 묶음 컨펌이면 하나다. */
  cardIds: string[]
  /** 승인 모드가 `auto`라 카드 없이 게이트(T-053)가 승인을 기록할 항목 수. */
  autoPending: number
  /** 이미 대기 카드가 있거나 대상이 아니라 건너뛴 항목 수. */
  skipped: number
}

export interface PublicationMarkPublishedRequest extends PublicationItemRequest {
  /** `https://` 링크(선택). 텍스트로만 저장한다. */
  link?: string
}

export type PublishOutcomeStatus =
  | 'published' // 어댑터가 발행함
  | 'manual-required' // `manual`이거나 연결된 어댑터가 없다: CEO가 직접 게시한 뒤 mark-published
  | 'reapproval-required' // 승인 뒤 내용이 바뀌었다. 항목은 draft로 돌아갔다
  | 'failed'

export interface PublicationPublishResult {
  status: PublishOutcomeStatus
  entry: PublicationEntry
}

export interface PublicationProgress {
  projectId: string
  /** 회사 시간대 기준 오늘 (YYYY-MM-DD). */
  date: string
  /** 정책의 일일 산출 목표. */
  goal: number
  approvedToday: number
  publishedToday: number
}
