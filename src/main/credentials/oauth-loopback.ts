import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { secrets } from './redact'

/**
 * OAuth 루프백 헬퍼(RFC 8252 + PKCE). 시스템 브라우저로 인증 URL을 열고 `127.0.0.1` 임의 포트로 돌아오는 리다이렉트를 받는다.
 * 앱 내 웹뷰는 쓰지 않는다. 네트워크 호출(토큰 교환)은 이 헬퍼가 하지 않고 어댑터가 한다.
 * 의존성(브라우저 열기, 시간, 난수)은 주입 가능해 실제 외부 네트워크 없이 테스트한다.
 */

export type OAuthErrorCode = 'timeout' | 'state-mismatch' | 'denied' | 'aborted' | 'listen-failed'

export class OAuthError extends Error {
  constructor(readonly code: OAuthErrorCode) {
    super(code)
    this.name = 'OAuthError'
  }
}

const CALLBACK_PATH = '/callback'
export const DEFAULT_OAUTH_TIMEOUT_MS = 5 * 60 * 1000
const MAX_TIMEOUT_MS = 15 * 60 * 1000

const b64url = (b: Buffer): string => b.toString('base64url')

export interface Pkce {
  verifier: string
  challenge: string
}

export function createPkce(random: (n: number) => Buffer = randomBytes): Pkce {
  const verifier = b64url(random(32))
  return { verifier, challenge: b64url(createHash('sha256').update(verifier).digest()) }
}

function sameString(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export interface LoopbackParams {
  /** 어댑터가 플랫폼 인증 URL을 만든다. `redirectUri`, `state`, PKCE `challenge`를 넣어야 한다. */
  buildAuthUrl(p: { redirectUri: string; state: string; codeChallenge: string }): string
  /** 허용 목록 검사가 들어 있는 시스템 브라우저 열기 (`openExternal`, T-034). */
  openExternal(url: string): Promise<void>
  timeoutMs?: number
  signal?: AbortSignal
  random?: (n: number) => Buffer
}

export interface LoopbackResult {
  /** 인증 코드. 토큰 교환은 어댑터가 `codeVerifier`와 함께 한다. */
  code: string
  codeVerifier: string
  redirectUri: string
}

const PAGE =
  '<!doctype html><meta charset="utf-8"><title>My Company</title><p>연결 요청을 받았어요. 이 창을 닫고 앱으로 돌아가세요.</p>'

export async function runLoopbackAuth(p: LoopbackParams): Promise<LoopbackResult> {
  const random = p.random ?? randomBytes
  const timeoutMs = Math.min(Math.max(p.timeoutMs ?? DEFAULT_OAUTH_TIMEOUT_MS, 1), MAX_TIMEOUT_MS)
  const state = b64url(random(24))
  const pkce = createPkce(random)
  secrets.register(pkce.verifier)

  return new Promise<LoopbackResult>((resolve, reject) => {
    let settled = false
    let timer: NodeJS.Timeout | undefined
    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      p.signal?.removeEventListener('abort', onAbort)
      server.close()
      server.closeAllConnections()
      fn()
    }
    const fail = (code: OAuthErrorCode): void => finish(() => reject(new OAuthError(code)))
    const onAbort = (): void => fail('aborted')
    const server: Server = createServer((req, res) => {
      // 루프백 요청만, 콜백 경로만 받는다. 그 밖의 요청은 상태를 바꾸지 않는다.
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (req.method !== 'GET' || url.pathname !== CALLBACK_PATH) {
        res.writeHead(404).end()
        return
      }
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer'
      })
      res.end(PAGE)
      const got = url.searchParams.get('state') ?? ''
      if (!sameString(got, state)) return fail('state-mismatch')
      const code = url.searchParams.get('code')
      if (url.searchParams.has('error') || code === null || code === '') return fail('denied')
      secrets.register(code)
      const redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}${CALLBACK_PATH}`
      finish(() => resolve({ code, codeVerifier: pkce.verifier, redirectUri }))
    })
    if (p.signal?.aborted) return fail('aborted')
    p.signal?.addEventListener('abort', onAbort)
    server.on('error', () => fail('listen-failed'))
    // 포트 0: OS가 임의 포트를 고른다. 127.0.0.1에만 묶어 외부에서 접근할 수 없다.
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port
      const redirectUri = `http://127.0.0.1:${port}${CALLBACK_PATH}`
      timer = setTimeout(() => fail('timeout'), timeoutMs)
      let authUrl: string
      try {
        authUrl = p.buildAuthUrl({ redirectUri, state, codeChallenge: pkce.challenge })
      } catch {
        return fail('listen-failed')
      }
      p.openExternal(authUrl).catch(() => fail('aborted'))
    })
  })
}
