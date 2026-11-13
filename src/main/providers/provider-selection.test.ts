import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ProviderCliId, ProviderDetection } from '../../shared/provider'
import { NoCompanyError, type CompanyContext } from '../company/company-context'
import { SafeFs } from '../repository/safe-fs'
import { ClaudeAdapter } from './claude/claude-adapter'
import { CodexAdapter } from './codex/codex-adapter'
import { GeminiAdapter } from './gemini/gemini-adapter'
import {
  PROVIDER_CAPABILITIES,
  ProviderSelectionService,
  SELECTION_FILE,
  checkRunRequirements,
  createSelectionStore,
  parseProviderSelection,
  resolveProvider
} from './provider-selection'
import { createProviderSelectionHandlers } from './provider-selection-ipc'

const det = (
  states: Partial<Record<ProviderCliId, ProviderDetection['state']>>
): ProviderDetection[] =>
  (['claude', 'codex', 'gemini'] as const).map((provider) => ({
    provider,
    state: states[provider] ?? 'not-installed',
    version: null,
    message: ''
  }))
const ALL_OK = det({ claude: 'ok', codex: 'ok', gemini: 'ok' })

describe('parseProviderSelection', () => {
  it('accepts valid values', () => {
    expect(
      parseProviderSelection({ defaultProvider: 'codex', overrides: { 'dev-1': 'gemini' } })
    ).toEqual({ defaultProvider: 'codex', overrides: { 'dev-1': 'gemini' } })
  })

  it.each([
    null,
    [],
    { defaultProvider: 'gpt', overrides: {} },
    { defaultProvider: 'claude' },
    { defaultProvider: 'claude', overrides: [] },
    { defaultProvider: 'claude', overrides: { 'a/b': 'claude' } },
    { defaultProvider: 'claude', overrides: { '../x': 'claude' } },
    { defaultProvider: 'claude', overrides: { dev: 'rm -rf' } },
    { defaultProvider: 'claude', overrides: {}, apiKey: 'x' }
  ])('rejects %j', (input) => {
    expect(parseProviderSelection(input)).toBeNull()
  })

  it('rejects too many overrides', () => {
    const overrides = Object.fromEntries(
      Array.from({ length: 101 }, (_, i) => [`e${i}`, 'claude' as const])
    )
    expect(parseProviderSelection({ defaultProvider: 'claude', overrides })).toBeNull()
  })
})

describe('resolveProvider priority', () => {
  it('employee override beats company default', () => {
    const r = resolveProvider(
      { defaultProvider: 'codex', overrides: { dev: 'gemini' } },
      ALL_OK,
      'dev'
    )
    expect(r).toMatchObject({ ok: true, provider: 'gemini', source: 'employee' })
  })
  it('company default beats claude', () => {
    const r = resolveProvider({ defaultProvider: 'codex', overrides: {} }, ALL_OK, 'dev')
    expect(r).toMatchObject({ ok: true, provider: 'codex', source: 'company' })
  })
  it('falls back to claude with empty settings', () => {
    const r = resolveProvider({ defaultProvider: 'claude', overrides: {} }, ALL_OK)
    expect(r).toMatchObject({ ok: true, provider: 'claude', notices: [] })
  })
})

describe('resolveProvider fallback', () => {
  it('replaces an uninstalled override with the company default and notifies', () => {
    const r = resolveProvider(
      { defaultProvider: 'claude', overrides: { dev: 'gemini' } },
      det({ claude: 'ok' }),
      'dev'
    )
    expect(r).toMatchObject({ ok: true, provider: 'claude', source: 'default' })
    if (r.ok) expect(r.notices.map((n) => n.code)).toEqual(['fallback'])
  })
  it('falls back to claude when both are missing', () => {
    const r = resolveProvider(
      { defaultProvider: 'codex', overrides: { dev: 'gemini' } },
      det({ claude: 'ok' }),
      'dev'
    )
    expect(r).toMatchObject({ ok: true, provider: 'claude' })
  })
  it('rejects when nothing usable, without leaking internals', () => {
    const r = resolveProvider({ defaultProvider: 'codex', overrides: {} }, det({}))
    expect(r).toMatchObject({ ok: false, code: 'provider-unavailable' })
    expect(JSON.stringify(r)).not.toMatch(/[\\/]/)
  })
  it('treats exec-failed and timeout as unusable', () => {
    const r = resolveProvider(
      { defaultProvider: 'codex', overrides: {} },
      det({ claude: 'ok', codex: 'exec-failed' })
    )
    expect(r).toMatchObject({ ok: true, provider: 'claude' })
  })
})

describe('tool bridge demotion', () => {
  it.each(['codex', 'gemini'] as const)('%s runs with auto mode off', (p) => {
    const r = resolveProvider({ defaultProvider: p, overrides: {} }, ALL_OK)
    expect(r).toMatchObject({ ok: true, autoAllowed: false })
    if (r.ok) expect(r.notices.map((n) => n.code)).toContain('auto-disabled')
  })
  it('claude keeps auto mode available', () => {
    const r = resolveProvider({ defaultProvider: 'claude', overrides: {} }, ALL_OK)
    expect(r).toMatchObject({ ok: true, autoAllowed: true })
  })
  it('screens tools/hr runs by capabilities before launch', () => {
    expect(checkRunRequirements('codex', { tools: true })).toMatchObject({
      ok: false,
      code: 'tool-bridge-unsupported'
    })
    expect(checkRunRequirements('gemini', { hr: true })).toMatchObject({
      ok: false,
      code: 'path-scope-unsupported'
    })
    expect(checkRunRequirements('claude', { tools: true, hr: true })).toEqual({ ok: true })
    expect(checkRunRequirements('codex', {})).toEqual({ ok: true })
  })
  it('static capability table matches the adapters', () => {
    expect(PROVIDER_CAPABILITIES.claude).toEqual(new ClaudeAdapter({ cwd: '/x' }).capabilities)
    expect(PROVIDER_CAPABILITIES.codex).toEqual(new CodexAdapter({ cwd: '/x' }).capabilities)
    expect(PROVIDER_CAPABILITIES.gemini).toEqual(new GeminiAdapter({ cwd: '/x' }).capabilities)
  })
})

describe('store and service', () => {
  let dir: string
  let fs: SafeFs
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sel-'))
    fs = await SafeFs.open(dir)
  })
  afterEach(() => rm(dir, { recursive: true, force: true }))

  it('persists to the company folder and reloads', async () => {
    const svc = new ProviderSelectionService({
      store: createSelectionStore(fs),
      detect: async () => ALL_OK
    })
    await svc.save({ defaultProvider: 'gemini', overrides: { dev: 'codex' } })
    expect(JSON.parse(await readFile(join(dir, SELECTION_FILE), 'utf8'))).toEqual({
      defaultProvider: 'gemini',
      overrides: { dev: 'codex' }
    })
    expect((await svc.get()).defaultProvider).toBe('gemini')
  })

  it('does not write when input is invalid', async () => {
    const svc = new ProviderSelectionService({
      store: createSelectionStore(fs),
      detect: async () => ALL_OK
    })
    expect(await svc.save({ defaultProvider: 'bad', overrides: {} })).toBeNull()
    expect(await fs.exists(SELECTION_FILE)).toBe(false)
  })

  it('treats a corrupt file as defaults', async () => {
    await fs.writeText(SELECTION_FILE, '{not json')
    expect(await createSelectionStore(fs).load()).toEqual({
      defaultProvider: 'claude',
      overrides: {}
    })
  })

  it('keeps an in-flight snapshot after settings change', async () => {
    const svc = new ProviderSelectionService({
      store: createSelectionStore(fs),
      detect: async () => ALL_OK
    })
    await svc.save({ defaultProvider: 'codex', overrides: {} })
    const running = await svc.snapshot()
    await svc.save({ defaultProvider: 'gemini', overrides: {} })
    expect(running.resolve()).toMatchObject({ ok: true, provider: 'codex' })
    expect((await svc.snapshot()).resolve()).toMatchObject({ ok: true, provider: 'gemini' })
  })

  it('snapshot survives detection failure by rejecting, not throwing', async () => {
    const svc = new ProviderSelectionService({
      store: createSelectionStore(fs),
      detect: async () => {
        throw new Error('/secret/path')
      }
    })
    expect((await svc.snapshot()).resolve()).toMatchObject({ ok: false })
  })

  describe('ipc handlers', () => {
    const ctx = (open: boolean): CompanyContext =>
      ({
        requireOpenCompany: () => {
          if (!open) throw new NoCompanyError()
          return { fs }
        }
      }) as unknown as CompanyContext
    const providers = { detect: async () => ALL_OK }

    it('saves and returns the value, rejects invalid input', async () => {
      const h = createProviderSelectionHandlers({ context: ctx(true), providers })
      const ok = await h.saveProviderSelection({ defaultProvider: 'codex', overrides: {} })
      expect(ok).toEqual({ ok: true, value: { defaultProvider: 'codex', overrides: {} } })
      expect(await h.getProviderSelection()).toEqual(ok)
      const bad = await h.saveProviderSelection({ defaultProvider: 'x', overrides: {} })
      expect(bad).toMatchObject({ ok: false, code: 'invalid-request' })
    })

    it('reports no-company without internals', async () => {
      const h = createProviderSelectionHandlers({ context: ctx(false), providers })
      expect(await h.getProviderSelection()).toMatchObject({ ok: false, code: 'no-company' })
    })
  })
})
