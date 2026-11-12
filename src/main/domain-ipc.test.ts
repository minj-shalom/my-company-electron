import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConnectionTestResult } from '../shared/provider'
import { CompanyContext } from './company/company-context'
import { createDomainHandlers, trustedHandler } from './domain-ipc'
import { ProviderService } from './providers/provider-service'
import { createWeeklyLimitsStore } from './settings/weekly-limits-store'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mc-dom-'))
})
afterEach(() => rm(dir, { recursive: true, force: true }))

const ctx = (): CompanyContext =>
  new CompanyContext({ store: { load: async () => null, save: async () => undefined } })
const ok = (provider: 'claude'): ConnectionTestResult => ({ provider, state: 'ok', message: 'ok' })

describe('provider handlers', () => {
  it('rejects unknown providers without running anything', async () => {
    const test = vi.fn()
    const h = createDomainHandlers({
      context: ctx(),
      providers: new ProviderService({ test }),
      limits: createWeeklyLimitsStore(dir)
    })
    for (const bad of ['rm', '', 5, null, undefined, { a: 1 }, '../claude']) {
      expect((await h.testProviderConnection(bad)).ok).toBe(false)
    }
    expect(test).not.toHaveBeenCalled()
  })

  it('does not run a connection test on detect', async () => {
    const test = vi.fn()
    const detect = vi.fn(async () => [])
    const h = createDomainHandlers({
      context: ctx(),
      providers: new ProviderService({ detect, test }),
      limits: createWeeklyLimitsStore(dir)
    })
    expect(await h.detectProviders()).toEqual({ ok: true, value: [] })
    expect(test).not.toHaveBeenCalled()
  })

  it('merges duplicate clicks and aborts on shutdown', async () => {
    let release: (r: ConnectionTestResult) => void = () => undefined
    let signal: AbortSignal | undefined
    const test = vi.fn((_p: string, o?: { signal?: AbortSignal }) => {
      signal = o?.signal
      return new Promise<ConnectionTestResult>((r) => (release = r))
    })
    const svc = new ProviderService({ test })
    const a = svc.testConnection('claude')
    const b = svc.testConnection('claude')
    expect(a).toBe(b)
    expect(test).toHaveBeenCalledTimes(1)
    svc.shutdown()
    expect(signal?.aborted).toBe(true)
    release(ok('claude'))
    await a
    // 완료 후에는 새 실행으로 시작된다.
    const c = svc.testConnection('claude')
    expect(c).not.toBe(a)
    expect(test).toHaveBeenCalledTimes(2)
    release(ok('claude'))
    await c
  })

  it('returns an opaque internal error when the probe throws', async () => {
    const h = createDomainHandlers({
      context: ctx(),
      providers: new ProviderService({
        detect: async () => {
          throw new Error(`boom ${dir}`)
        }
      }),
      limits: createWeeklyLimitsStore(dir)
    })
    const r = await h.detectProviders()
    expect(r).toMatchObject({ ok: false, code: 'internal' })
    expect(JSON.stringify(r)).not.toContain(dir)
  })
})

describe('weekly limits', () => {
  const make = (): ReturnType<typeof createDomainHandlers> =>
    createDomainHandlers({
      context: ctx(),
      providers: new ProviderService(),
      limits: createWeeklyLimitsStore(dir)
    })

  it('starts empty, saves, and reloads', async () => {
    const h = make()
    expect(await h.getWeeklyLimits()).toEqual({ ok: true, value: [] })
    const limits = [{ provider: 'claude', amount: 20.5, unit: 'usd' }]
    expect(await h.saveWeeklyLimits({ limits })).toEqual({ ok: true, value: limits })
    expect(await make().getWeeklyLimits()).toEqual({ ok: true, value: limits })
  })

  it('rejects invalid requests and keeps the previous value', async () => {
    const h = make()
    const good = [{ provider: 'claude', amount: 10, unit: 'usd' }]
    await h.saveWeeklyLimits({ limits: good })
    const bad: unknown[] = [
      null,
      {},
      { limits: 'x' },
      { limits: [{ provider: 'claude', amount: 0, unit: 'usd' }] },
      { limits: [{ provider: 'claude', amount: -1, unit: 'usd' }] },
      { limits: [{ provider: 'claude', amount: NaN, unit: 'usd' }] },
      { limits: [{ provider: 'claude', amount: 1.234, unit: 'usd' }] },
      { limits: [{ provider: 'claude', amount: 1e9, unit: 'usd' }] },
      { limits: [{ provider: 'claude', amount: '5', unit: 'usd' }] },
      { limits: [{ provider: 'claude', amount: 5, unit: 'pct' }] },
      { limits: [{ provider: 'evil', amount: 5, unit: 'usd' }] },
      {
        limits: [
          { provider: 'claude', amount: 5, unit: 'usd' },
          { provider: 'claude', amount: 6, unit: 'usd' }
        ]
      }
    ]
    for (const b of bad)
      expect(await h.saveWeeklyLimits(b)).toMatchObject({ ok: false, code: 'invalid-request' })
    expect(await h.getWeeklyLimits()).toEqual({ ok: true, value: good })
  })

  it('strips extra fields and treats a corrupt file as empty', async () => {
    const h = make()
    const r = await h.saveWeeklyLimits({
      limits: [{ provider: 'codex', amount: 5, unit: 'usd', token: 'secret' }]
    })
    expect(r).toEqual({ ok: true, value: [{ provider: 'codex', amount: 5, unit: 'usd' }] })
    await writeFile(join(dir, 'weekly-limits.json'), '{not json', 'utf8')
    expect(await h.getWeeklyLimits()).toEqual({ ok: true, value: [] })
  })
})

describe('trustedHandler', () => {
  it('rejects untrusted senders without calling the handler', async () => {
    const fn = vi.fn(async () => 'x')
    const h = trustedHandler(() => false, fn)
    await expect(h({}, 1)).rejects.toThrow('Untrusted sender')
    expect(fn).not.toHaveBeenCalled()
  })
  it('passes the argument for trusted senders', async () => {
    const fn = vi.fn(async (a: unknown) => a)
    expect(await trustedHandler(() => true, fn)({}, 7)).toBe(7)
  })
})
