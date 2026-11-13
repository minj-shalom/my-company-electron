/**
 * 발행 어댑터 계약(T-054, 플랫폼 공통)과 자격 증명 상태 타입. main/preload/renderer 공용이다.
 *
 * 자격 증명 값은 이 파일의 어떤 타입에도 없다. renderer가 받는 것은 상태·만료 시각·표시명뿐이다.
 */

/** 허용된 어댑터 id. 레지스트리와 정책(`발행 어댑터`)이 이 목록만 참조한다. 새 플랫폼은 여기에 추가하고 리뷰한다. */
export const PUBLISHER_ADAPTER_IDS = ['manual'] as const
export type PublisherAdapterId = (typeof PUBLISHER_ADAPTER_IDS)[number]

export const ADAPTER_ID = /^[a-z][a-z0-9-]{0,31}$/
/** 어댑터 안의 계정 식별자. 사용자 이메일 같은 값을 그대로 쓰지 않는다. */
export const ACCOUNT_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/
export const MAX_DISPLAY_NAME = 80

export const CREDENTIAL_STATES = ['connected', 'disconnected', 'expiring', 'error'] as const
export type CredentialState = (typeof CREDENTIAL_STATES)[number]

/** 어댑터가 요청하는 권한 하나. `description`은 연결 화면에 사람 말로 보인다 (예: "글 게시만 허용, 읽기·삭제 없음"). */
export interface PublisherScope {
  id: string
  description: string
}

export interface CredentialAccountStatus {
  accountId: string
  /** 비민감 표시명 (예: 블로그 이름). 토큰·이메일 전체를 넣지 않는다. */
  displayName: string
  /** ISO 8601. 만료가 없으면 null. */
  expiresAt: string | null
}

/** renderer가 받는 자격 증명 상태. 값은 없다. */
export interface CredentialAdapterStatus {
  adapterId: string
  displayName: string
  scopes: PublisherScope[]
  state: CredentialState
  accounts: CredentialAccountStatus[]
  /** 이 컴퓨터의 보안 저장소를 쓸 수 있는지. false면 연결을 거부한다 (평문 폴백 없음). */
  encryptionAvailable: boolean
}

export interface CredentialDisconnectRequest {
  adapterId: string
}

export interface CredentialDisconnectResult {
  status: CredentialAdapterStatus
  /** 서버 측 토큰 폐기에 성공했는지. false여도 로컬 값은 삭제됐다. */
  revoked: boolean
}

export const MEDIA_KINDS = ['video', 'image'] as const
export type MediaKind = (typeof MEDIA_KINDS)[number]

/** 발행 요청이 가리키는 미디어 한 개. 파일은 main이 읽고 해시를 다시 검증한다 (LLM·renderer는 바이트를 보내지 않는다). */
export interface PublisherMedia {
  kind: MediaKind
  /** 산출물 폴더 기준 상대 경로. */
  path: string
  /** 승인된 파일 내용의 SHA-256 (64자리 hex). */
  contentHash: string
}

/** main이 경로·크기·확장자·MIME 매직 바이트·해시를 검증한 미디어. 어댑터는 이 값만 믿고 `absPath`를 읽는다. */
export interface VerifiedMedia extends PublisherMedia {
  mime: string
  size: number
  /** 심볼릭 링크를 풀고 산출물 폴더 안임을 확인한 절대 경로. 오류·로그·IPC 응답에 넣지 않는다. */
  absPath: string
}

/** 발행 요청. 본문은 main이 초안 파일에서 읽어 채운다 (LLM과 renderer는 본문을 보내지 않는다). */
export interface PublisherPublishRequest {
  projectId: string
  /** 산출물 폴더 기준 상대 경로. */
  draftPath: string
  /** 승인된 초안 내용의 SHA-256 (64자리 hex). */
  contentHash: string
  title: string
  body: string
  idempotencyKey: string
  /** main이 검증을 마친 미디어. 없으면 텍스트만 발행한다. */
  media?: VerifiedMedia[]
}

/** 실패 사유는 닫힌 목록이다. 원문 오류(URL, 토큰이 섞일 수 있음)를 담지 않는다. */
export const PUBLISH_ERROR_CODES = [
  'hash-mismatch',
  'not-connected',
  'rejected',
  'network',
  'auth',
  'quota', // 일일 할당량 등 한도 초과
  'needs-review', // 앱 심사 전이라 제한됨
  'media-invalid', // 미디어 경로·형식·크기 위반
  'pending', // 플랫폼이 비동기로 처리 중. 결과를 아직 알 수 없다
  'unknown'
] as const
export type PublishErrorCode = (typeof PUBLISH_ERROR_CODES)[number]

export type PublisherPublishResult =
  { ok: true; link?: string; dryRun?: boolean } | { ok: false; code: PublishErrorCode }

/** 게이트(T-050)가 아는 실패 코드. 어댑터 코드는 `GATE_CODE`로 이 목록에 사상된다. */
export const GATE_ERROR_CODES = [
  'rejected',
  'network',
  'auth',
  'quota',
  'needs-review',
  'media-invalid',
  'pending',
  'confirm-required', // 이전 시도의 게시 여부를 알 수 없다. 자동 재시도 금지
  'unknown'
] as const
export type GatePublishErrorCode = (typeof GATE_ERROR_CODES)[number]

/** 발행 항목에 남기는 실패 안내 문구 (사용자에게 보임). 원문 오류를 담지 않는다. */
export const GATE_FAILURE_NOTES: Record<GatePublishErrorCode, string> = {
  rejected: '발행 어댑터가 요청을 거절했습니다.',
  network: '네트워크 오류로 발행하지 못했습니다.',
  auth: '발행 계정 연결을 확인해야 합니다.',
  quota: '발행 한도를 넘었습니다. 한도가 풀린 뒤 다시 시도하세요.',
  'needs-review': '플랫폼 앱 심사가 끝나기 전이라 발행이 제한됩니다.',
  'media-invalid': '첨부한 영상·이미지가 올바르지 않습니다. 파일을 확인하세요.',
  pending: '플랫폼에서 아직 처리 중입니다. 잠시 뒤 게시 여부를 확인하세요.',
  'confirm-required':
    '발행 확인 필요: 게시됐는지 플랫폼에서 직접 확인하세요. 자동으로 다시 시도하지 않습니다.',
  unknown: '발행하지 못했습니다.'
}

export interface PublisherPublishOptions {
  /** true면 실제 게시 없이 검증만 한다 (자격 증명·스코프·본문 형식). */
  dryRun?: boolean
  signal?: AbortSignal
}

/** 어댑터가 쓰는 자격 증명 접근. 자기 어댑터의 키만 다루고 값은 main 메모리 안에서만 흐른다. */
export interface AdapterVault {
  get(accountId: string): Promise<string | null>
  set(
    accountId: string,
    value: string,
    meta: { displayName: string; expiresAt: string | null }
  ): Promise<void>
  delete(accountId: string): Promise<void>
  accounts(): Promise<CredentialAccountStatus[]>
}

export interface AdapterContext {
  adapterId: string
  vault: AdapterVault
  /** 허용 목록 URL만 시스템 브라우저로 연다. 앱 내 웹뷰는 쓰지 않는다. */
  openExternal(url: string): Promise<void>
  /** 토큰 갱신 실패 등으로 상태를 낮춘다 (`withFreshToken`이 사용). 다음 `vault.set`(재연결)이 되돌린다. */
  markDegraded(state: 'expiring' | 'error'): void
  signal?: AbortSignal
}

/**
 * 발행 어댑터. 구현은 main에서만 존재한다.
 *
 * 계약:
 * - `publish`는 발행 시점에 초안 파일을 다시 해시해 `contentHash`와 일치할 때만 게시한다 (T-050 검수 요구).
 *   호출자(main의 `toGatePublisher`)가 초안을 다시 읽어 해시를 검증한 뒤 `body`를 채우며, 일치하지 않으면 어댑터를 부르지 않고
 *   `hash-mismatch`로 실패시킨다. 어댑터는 `body`를 다른 곳에서 읽거나 바꾸지 않는다.
 * - 로그·오류·반환값에 자격 증명, 요청 헤더, 응답의 토큰 필드를 남기지 않는다. 실패는 `PublishErrorCode`로만 돌려준다.
 * - `connect`는 값을 반환하지 않는다. 얻은 값은 `ctx.vault`에 저장한다.
 * - 필요한 최소 스코프만 `scopes`로 선언한다 (게시 쓰기만, 읽기·삭제 제외).
 */
export interface PublisherAdapter {
  readonly id: string
  readonly displayName: string
  readonly scopes: readonly PublisherScope[]
  /** 자격 증명을 쓰지 않으면 false (`manual`). */
  readonly usesCredentials: boolean
  connect(ctx: AdapterContext): Promise<void>
  status(ctx: AdapterContext): Promise<{ state: CredentialState }>
  /** 가능하면 서버 측 토큰을 폐기한다. 폐기 여부를 돌려주며 로컬 값 삭제는 호출자가 보장한다. */
  disconnect(ctx: AdapterContext): Promise<{ revoked: boolean }>
  publish(
    req: PublisherPublishRequest,
    ctx: AdapterContext,
    opts?: PublisherPublishOptions
  ): Promise<PublisherPublishResult>
}
