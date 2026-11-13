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
}

/** 실패 사유는 닫힌 목록이다. 원문 오류(URL, 토큰이 섞일 수 있음)를 담지 않는다. */
export const PUBLISH_ERROR_CODES = [
  'hash-mismatch',
  'not-connected',
  'rejected',
  'network',
  'auth',
  'unknown'
] as const
export type PublishErrorCode = (typeof PUBLISH_ERROR_CODES)[number]

export type PublisherPublishResult =
  { ok: true; link?: string; dryRun?: boolean } | { ok: false; code: PublishErrorCode }

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
  vault: AdapterVault
  /** 허용 목록 URL만 시스템 브라우저로 연다. 앱 내 웹뷰는 쓰지 않는다. */
  openExternal(url: string): Promise<void>
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
