import type { AdapterContext } from '../../shared/publisher'

/** 만료까지 이 시간 이하면 사용 전에 갱신한다. */
export const REFRESH_MARGIN_MS = 60_000

/** 어댑터가 제공하는 갱신 함수. 입력은 보관소의 현재 값, 출력은 새로 보관할 값이다 (형식은 어댑터가 정한다). */
export type TokenRefresher = (current: string) => Promise<{
  value: string
  expiresAt: string | null
  displayName?: string
}>

export type FreshTokenResult =
  { ok: true; token: string } | { ok: false; code: 'auth' | 'not-connected' }

export interface FreshTokenOptions {
  accountId: string
  refresh: TokenRefresher
  now?: () => Date
}

/** 같은 어댑터·계정의 갱신을 한 줄로 세운다. 두 번째 호출은 첫 번째가 저장한 값을 다시 읽어 갱신을 건너뛴다. */
const chains = new Map<string, Promise<unknown>>()

function serialize<T>(key: string, job: () => Promise<T>): Promise<T> {
  const run = (chains.get(key) ?? Promise.resolve()).then(job, job)
  const tail = run.catch(() => undefined)
  chains.set(key, tail)
  void tail.then(() => {
    if (chains.get(key) === tail) chains.delete(key)
  })
  return run
}

/**
 * 만료 60초 전이면 refresh하고 새 값을 보관소에 저장한 뒤 돌려준다.
 * 갱신이 실패하면 오류 내용은 버리고 `auth`만 돌려주며, 상태를 `expiring`(아직 유효)이나 `error`(만료됨)로 낮춘다.
 * 토큰 값은 반환값 외 어디에도 남기지 않는다.
 */
export async function withFreshToken(
  ctx: AdapterContext,
  opts: FreshTokenOptions
): Promise<FreshTokenResult> {
  const now = opts.now ?? (() => new Date())
  return serialize(`${ctx.adapterId}:${opts.accountId}`, async (): Promise<FreshTokenResult> => {
    const current = await ctx.vault.get(opts.accountId)
    if (current === null) return { ok: false, code: 'not-connected' }
    const acc = (await ctx.vault.accounts()).find((a) => a.accountId === opts.accountId)
    const expiresMs = acc?.expiresAt == null ? null : Date.parse(acc.expiresAt)
    const t = now().getTime()
    if (expiresMs === null || Number.isNaN(expiresMs) || expiresMs - t > REFRESH_MARGIN_MS)
      return { ok: true, token: current }
    try {
      const next = await opts.refresh(current)
      await ctx.vault.set(opts.accountId, next.value, {
        displayName: next.displayName ?? acc?.displayName ?? opts.accountId,
        expiresAt: next.expiresAt
      })
      return { ok: true, token: next.value }
    } catch {
      ctx.markDegraded(expiresMs !== null && expiresMs > t ? 'expiring' : 'error')
      return { ok: false, code: 'auth' }
    }
  })
}
