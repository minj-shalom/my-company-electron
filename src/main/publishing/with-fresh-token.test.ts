import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CredentialService } from '../credentials/credential-service'
import { CredentialVault } from '../credentials/credential-vault'
import { SecretRegistry } from '../credentials/redact'
import { DUMMY_TOKEN, fakeSafeStorage } from '../credentials/test-helpers'
import { AdapterRegistry } from './adapter-registry'
import { createFakeAdapter } from './fake-adapter'
import { withFreshToken } from './with-fresh-token'

const NOW = new Date('2026-01-01T00:00:00Z')
const at = (sec: number): string => new Date(NOW.getTime() + sec * 1000).toISOString()

async function setup(expiresAt: string | null): Promise<{
  service: CredentialService
  ctx: ReturnType<CredentialService['contextFor']>
}> {
  const registry = new AdapterRegistry([createFakeAdapter()], ['fake'])
  const vault = new CredentialVault({
    userDataDir: await mkdtemp(join(tmpdir(), 'mc-wft-')),
    safeStorage: fakeSafeStorage(),
    allowedAdapterIds: ['fake'],
    registry: new SecretRegistry()
  })
  const service = new CredentialService({
    vault,
    registry,
    openExternal: async () => undefined,
    now: () => NOW
  })
  const ctx = service.contextFor('fake')
  await ctx.vault.set('default', DUMMY_TOKEN, { displayName: '블로그', expiresAt })
  return { service, ctx }
}

describe('withFreshToken', () => {
  it('returns the stored token without refreshing when expiry is far', async () => {
    const { ctx } = await setup(at(3600))
    let calls = 0
    const r = await withFreshToken(ctx, {
      accountId: 'default',
      now: () => NOW,
      refresh: async () => (calls++, { value: 'x', expiresAt: null })
    })
    expect(r).toEqual({ ok: true, token: DUMMY_TOKEN })
    expect(calls).toBe(0)
  })

  it('refreshes within 60 seconds of expiry and stores the new value', async () => {
    const { ctx } = await setup(at(30))
    const r = await withFreshToken(ctx, {
      accountId: 'default',
      now: () => NOW,
      refresh: async (cur) => ({ value: `${cur}-renewed`, expiresAt: at(3600) })
    })
    expect(r).toEqual({ ok: true, token: `${DUMMY_TOKEN}-renewed` })
    expect(await ctx.vault.get('default')).toBe(`${DUMMY_TOKEN}-renewed`)
  })

  it('returns auth and lowers the state when refresh fails, without leaking the error', async () => {
    const soon = await setup(at(30))
    const r1 = await withFreshToken(soon.ctx, {
      accountId: 'default',
      now: () => NOW,
      refresh: async (cur) => {
        throw new Error(`refresh failed for ${cur}`)
      }
    })
    expect(r1).toEqual({ ok: false, code: 'auth' })
    expect(JSON.stringify(r1)).not.toContain(DUMMY_TOKEN)
    expect((await soon.service.statusOf('fake')).state).toBe('expiring')

    const expired = await setup(at(-5))
    await withFreshToken(expired.ctx, {
      accountId: 'default',
      now: () => NOW,
      refresh: async () => {
        throw new Error('nope')
      }
    })
    expect((await expired.service.statusOf('fake')).state).toBe('error')
  })

  it('reports not-connected when nothing is stored', async () => {
    const { ctx } = await setup(null)
    await ctx.vault.delete('default')
    expect(
      await withFreshToken(ctx, {
        accountId: 'default',
        refresh: async () => ({ value: 'x', expiresAt: null })
      })
    ).toEqual({ ok: false, code: 'not-connected' })
  })

  it('serializes concurrent calls so refresh runs once', async () => {
    const { ctx } = await setup(at(10))
    let calls = 0
    const refresh = async (cur: string): Promise<{ value: string; expiresAt: string }> => {
      calls++
      await new Promise((r) => setTimeout(r, 20))
      return { value: `${cur}-r${calls}`, expiresAt: at(3600) }
    }
    const rs = await Promise.all(
      [1, 2, 3, 4].map(() => withFreshToken(ctx, { accountId: 'default', now: () => NOW, refresh }))
    )
    expect(calls).toBe(1)
    expect(new Set(rs.map((r) => (r.ok ? r.token : 'fail'))).size).toBe(1)
  })

  it('returns auth when refresh hangs past the deadline or the signal aborts', async () => {
    const { service, ctx } = await setup(at(10))
    const aborted = await setup(at(10))
    {
      const p = withFreshToken(ctx, {
        accountId: 'default',
        now: () => NOW,
        timeoutMs: 20,
        refresh: () => new Promise(() => undefined)
      })
      expect(await p).toEqual({ ok: false, code: 'auth' })
      expect((await service.statusOf('fake')).state).toBe('expiring')

      const ac = new AbortController()
      const q = withFreshToken(
        { ...aborted.ctx, signal: ac.signal },
        { accountId: 'default', now: () => NOW, refresh: () => new Promise(() => undefined) }
      )
      ac.abort()
      expect(await q).toEqual({ ok: false, code: 'auth' })
    }
  })
})
