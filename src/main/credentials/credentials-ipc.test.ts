import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, (event: unknown, ...a: unknown[]) => unknown>()
vi.mock('electron', () => ({
  ipcMain: {
    handle: (c: string, fn: (event: unknown, ...a: unknown[]) => unknown) => handlers.set(c, fn)
  }
}))

import { IPC_CHANNELS } from '../../shared/api'
import { AdapterRegistry } from '../publishing/adapter-registry'
import { createFakeAdapter, type FakeAdapter } from '../publishing/fake-adapter'
import { createManualAdapter } from '../publishing/manual-adapter'
import { CredentialService } from './credential-service'
import { CredentialVault } from './credential-vault'
import { createCredentialHandlers, registerCredentialHandlers } from './credentials-ipc'
import { createSafeLogger, SecretRegistry } from './redact'
import { DUMMY_TOKEN, fakeSafeStorage } from './test-helpers'

interface Setup {
  dir: string
  fake: FakeAdapter
  vault: CredentialVault
  service: CredentialService
  handlers: ReturnType<typeof createCredentialHandlers>
}

async function setup(opts: { token?: string; now?: Date } = {}): Promise<Setup> {
  const dir = await mkdtemp(join(tmpdir(), 'mc-cred-'))
  const fake = createFakeAdapter(opts.token ?? DUMMY_TOKEN)
  const registry = new AdapterRegistry([createManualAdapter(), fake], ['manual', 'fake'])
  const vault = new CredentialVault({
    userDataDir: dir,
    safeStorage: fakeSafeStorage(),
    allowedAdapterIds: registry.credentialAdapterIds(),
    registry: new SecretRegistry()
  })
  const service = new CredentialService({
    vault,
    registry,
    openExternal: async () => undefined,
    now: () => opts.now ?? new Date('2026-11-13T00:00:00Z')
  })
  return { dir, fake, vault, service, handlers: createCredentialHandlers(service) }
}

describe('credentials ipc', () => {
  it('rejects untrusted senders on both channels', async () => {
    registerCredentialHandlers((await setup()).service)
    for (const c of [IPC_CHANNELS.credentialsStatus, IPC_CHANNELS.credentialsDisconnect])
      expect(() =>
        handlers.get(c)!({ senderFrame: { url: 'https://evil.example/' } }, { adapterId: 'fake' })
      ).toThrow('Untrusted sender')
  })

  it('reports disconnected, connected and expiring without any value', async () => {
    const s = await setup()
    expect(await s.handlers.getCredentialStatus()).toMatchObject({
      ok: true,
      value: [{ adapterId: 'fake', state: 'disconnected', accounts: [], encryptionAvailable: true }]
    })
    await s.fake.connect(s.service.contextFor('fake'))
    const r = await s.handlers.getCredentialStatus()
    expect(r).toMatchObject({ ok: true, value: [{ state: 'connected' }] })
    expect(JSON.stringify(r)).not.toContain(DUMMY_TOKEN)
    await s.vault.set('fake:soon', DUMMY_TOKEN, {
      displayName: '곧 만료',
      expiresAt: '2026-11-15T00:00:00Z'
    })
    expect(await s.handlers.getCredentialStatus()).toMatchObject({ value: [{ state: 'expiring' }] })
  })

  it('validates disconnect input', async () => {
    const s = await setup()
    for (const bad of [
      undefined,
      null,
      'fake',
      {},
      { adapterId: 1 },
      { adapterId: '../x' },
      { adapterId: 'manual' },
      { adapterId: 'nope' }
    ])
      expect(await s.handlers.disconnectCredential(bad)).toMatchObject({
        ok: false,
        code: 'invalid-request'
      })
  })

  it('disconnect revokes on the server and deletes the local value', async () => {
    const s = await setup()
    await s.fake.connect(s.service.contextFor('fake'))
    const r = await s.handlers.disconnectCredential({ adapterId: 'fake' })
    expect(r).toMatchObject({
      ok: true,
      value: { revoked: true, status: { state: 'disconnected' } }
    })
    expect(s.fake.revokeCalls).toEqual([DUMMY_TOKEN])
    expect(await s.vault.get('fake:default')).toBeNull()
    expect(JSON.stringify(r)).not.toContain(DUMMY_TOKEN)
  })

  it('disconnect still deletes the local value when revoke fails, without leaking the error', async () => {
    const s = await setup()
    await s.fake.connect(s.service.contextFor('fake'))
    s.fake.failRevoke = true
    const r = await s.handlers.disconnectCredential({ adapterId: 'fake' })
    expect(r).toMatchObject({
      ok: true,
      value: { revoked: false, status: { state: 'disconnected' } }
    })
    expect(await s.vault.get('fake:default')).toBeNull()
    expect(JSON.stringify(r)).not.toContain(DUMMY_TOKEN)
  })

  it('has no channel, preload function or api type that returns a credential value', async () => {
    const credentialChannels = Object.values(IPC_CHANNELS).filter((c) =>
      /credential|vault|secret|token/i.test(c)
    )
    expect(credentialChannels.sort()).toEqual(['credentials:disconnect', 'credentials:status'])
    const preload = await readFile(join(__dirname, '../../preload/index.ts'), 'utf8')
    const used = [...preload.matchAll(/IPC_CHANNELS\.(credentials\w*)/g)].map((m) => m[1]).sort()
    expect(used).toEqual(['credentialsDisconnect', 'credentialsStatus'])
    expect(preload).not.toMatch(/safeStorage|credential-vault|credentialVault/)
    const ipcSrc = await readFile(join(__dirname, 'credentials-ipc.ts'), 'utf8')
    expect(ipcSrc).not.toMatch(/credential-vault|\.get\(/)
    // 값을 돌려줄 수 있는 이름이 공개 API 타입에 없어야 한다.
    const api = await readFile(join(__dirname, '../../shared/api.ts'), 'utf8')
    expect(api.match(/\b\w*(Credential|Token|Secret)\w*:/g)?.sort()).toEqual([
      'disconnectCredential:',
      'getCredentialStatus:'
    ])
  })

  it('never lets the secret reach logs, errors, results, or files on disk (string scan)', async () => {
    const secret = 'ZZ-scan-secret-9f3a1c-not-real'
    const s = await setup({ token: secret })
    const lines: string[] = []
    const reg = new SecretRegistry()
    reg.register(secret)
    const log = createSafeLogger((l) => lines.push(l), reg)
    const seen: string[] = []
    const spies = (['log', 'error', 'warn', 'info', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void seen.push(a.join(' ')))
    )
    try {
      await s.fake.connect(s.service.contextFor('fake'))
      // 어댑터가 오류 문자열에 값을 넣어 던지는 최악의 경우.
      s.fake.failRevoke = true
      const out = [
        await s.handlers.getCredentialStatus(),
        await s.handlers.disconnectCredential({ adapterId: 'fake' }),
        await s.handlers.disconnectCredential({ adapterId: secret })
      ]
      log.error(`revoke failed ${secret}`, new Error(secret))
      seen.push(JSON.stringify(out), ...lines)
    } finally {
      spies.forEach((x) => x.mockRestore())
    }
    expect(seen.join('\n')).not.toContain(secret)
    // 보관소 파일과 userData 어디에도 평문이 없다.
    await s.vault.set('fake:again', secret, { displayName: 'x', expiresAt: null })
    const files = (await readdir(s.dir, { recursive: true, withFileTypes: true })).filter((e) =>
      e.isFile()
    )
    for (const f of files)
      expect(await readFile(join(f.parentPath, f.name), 'utf8')).not.toContain(secret)
  })
})
