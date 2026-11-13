import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { OAuthError, runLoopbackAuth } from './oauth-loopback'

/** 루프백(127.0.0.1)으로만 통신한다. 외부 네트워크는 쓰지 않는다. */
function browser(mutate?: (u: URL, redirect: URL) => void): {
  seen: { auth?: URL }
  openExternal: (raw: string) => Promise<void>
} {
  const seen: { auth?: URL } = {}
  return {
    seen,
    openExternal: async (raw: string) => {
      const auth = new URL(raw)
      seen.auth = auth
      const redirect = new URL(auth.searchParams.get('redirect_uri') ?? '')
      redirect.searchParams.set('state', auth.searchParams.get('state') ?? '')
      redirect.searchParams.set('code', 'auth-code-123456')
      mutate?.(auth, redirect)
      setTimeout(() => void fetch(redirect).catch(() => undefined), 5)
    }
  }
}
const build = (p: { redirectUri: string; state: string; codeChallenge: string }): string => {
  const u = new URL('https://auth.example.test/authorize')
  u.searchParams.set('redirect_uri', p.redirectUri)
  u.searchParams.set('state', p.state)
  u.searchParams.set('code_challenge', p.codeChallenge)
  u.searchParams.set('code_challenge_method', 'S256')
  return u.toString()
}

describe('oauth loopback', () => {
  it('completes with PKCE, a random loopback port and a verified state', async () => {
    const b = browser()
    const r = await runLoopbackAuth({ buildAuthUrl: build, openExternal: b.openExternal })
    expect(r.code).toBe('auth-code-123456')
    const redirect = new URL(r.redirectUri)
    expect(redirect.hostname).toBe('127.0.0.1')
    expect(Number(redirect.port)).toBeGreaterThan(0)
    const challenge = b.seen.auth!.searchParams.get('code_challenge')
    expect(createHash('sha256').update(r.codeVerifier).digest('base64url')).toBe(challenge)
  })

  it('uses a different port and state each time', async () => {
    const a = browser()
    const c = browser()
    const r1 = await runLoopbackAuth({ buildAuthUrl: build, openExternal: a.openExternal })
    const r2 = await runLoopbackAuth({ buildAuthUrl: build, openExternal: c.openExternal })
    expect(a.seen.auth!.searchParams.get('state')).not.toBe(c.seen.auth!.searchParams.get('state'))
    expect(r1.codeVerifier).not.toBe(r2.codeVerifier)
  })

  it('rejects a mismatched state', async () => {
    const b = browser((_a, redirect) => redirect.searchParams.set('state', 'forged'))
    await expect(
      runLoopbackAuth({ buildAuthUrl: build, openExternal: b.openExternal })
    ).rejects.toMatchObject({ code: 'state-mismatch' })
  })

  it('rejects a provider error response', async () => {
    const b = browser((_a, redirect) => {
      redirect.searchParams.delete('code')
      redirect.searchParams.set('error', 'access_denied')
    })
    await expect(
      runLoopbackAuth({ buildAuthUrl: build, openExternal: b.openExternal })
    ).rejects.toMatchObject({ code: 'denied' })
  })

  it('times out when the browser never returns', async () => {
    await expect(
      runLoopbackAuth({ buildAuthUrl: build, openExternal: async () => undefined, timeoutMs: 30 })
    ).rejects.toMatchObject({ code: 'timeout' })
  })

  it('aborts on signal and when opening the browser fails', async () => {
    const ctl = new AbortController()
    const p = runLoopbackAuth({
      buildAuthUrl: build,
      openExternal: async () => undefined,
      signal: ctl.signal
    })
    ctl.abort()
    await expect(p).rejects.toBeInstanceOf(OAuthError)
    await expect(
      runLoopbackAuth({
        buildAuthUrl: build,
        openExternal: async () => {
          throw new Error('blocked')
        }
      })
    ).rejects.toMatchObject({ code: 'aborted' })
  })
})
