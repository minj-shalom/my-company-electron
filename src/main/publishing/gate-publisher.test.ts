import { createHash } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CredentialService } from '../credentials/credential-service'
import { CredentialVault } from '../credentials/credential-vault'
import { SecretRegistry } from '../credentials/redact'
import { fakeSafeStorage } from '../credentials/test-helpers'
import { AdapterRegistry } from './adapter-registry'
import type { Publisher } from '../gate/publisher'
import { createFakeAdapter, type FakeAdapter } from './fake-adapter'
import { createGatePublishers } from './gate-publisher'
import { createManualAdapter } from './manual-adapter'

const body = '# 제목\n\n본문입니다.\n'
const hash = createHash('sha256').update(body, 'utf8').digest('hex')
const req = {
  projectId: 'p1',
  adapterId: 'fake',
  draftPath: 'a.md',
  draftHash: hash,
  idempotencyKey: 'k1'
}

async function setup(current: string | null = body): Promise<{
  fake: FakeAdapter
  credentials: CredentialService
  publishers: Map<string, Publisher>
}> {
  const fake = createFakeAdapter()
  const registry = new AdapterRegistry([createManualAdapter(), fake], ['manual', 'fake'])
  const vault = new CredentialVault({
    userDataDir: await mkdtemp(join(tmpdir(), 'mc-gp-')),
    safeStorage: fakeSafeStorage(),
    allowedAdapterIds: ['fake'],
    registry: new SecretRegistry()
  })
  const credentials = new CredentialService({
    vault,
    registry,
    openExternal: async () => undefined
  })
  const publishers = createGatePublishers({
    registry,
    credentials,
    drafts: { read: async () => current }
  })
  return { fake, credentials, publishers }
}

describe('adapter registry', () => {
  it('rejects ids outside the allow list and duplicates', () => {
    expect(() => new AdapterRegistry([createFakeAdapter()])).toThrow('adapter-not-allowed')
    expect(() => new AdapterRegistry([createManualAdapter(), createManualAdapter()])).toThrow(
      'adapter-duplicate'
    )
    expect(new AdapterRegistry([createManualAdapter()]).credentialAdapterIds()).toEqual([])
  })
})

describe('gate publisher bridge', () => {
  it('publishes only when the re-read draft matches the approved hash', async () => {
    const s = await setup()
    await s.fake.connect(s.credentials.contextFor('fake'))
    expect(await s.publishers.get('fake')!.publish(req, new AbortController().signal)).toEqual({
      ok: true
    })
    expect(s.fake.published).toHaveLength(1)
    expect(s.fake.published[0]).toMatchObject({ contentHash: hash, title: '제목', body })
  })

  it('refuses and never calls the adapter when the draft changed after approval', async () => {
    const s = await setup('# 제목\n\n바뀐 본문\n')
    await s.fake.connect(s.credentials.contextFor('fake'))
    expect(await s.publishers.get('fake')!.publish(req, new AbortController().signal)).toEqual({
      ok: false,
      code: 'rejected'
    })
    expect(s.fake.published).toHaveLength(0)
  })

  it('fails when the draft cannot be read, and maps not-connected to auth', async () => {
    const gone = await setup(null)
    expect(
      await gone.publishers.get('fake')!.publish(req, new AbortController().signal)
    ).toMatchObject({
      ok: false
    })
    const s = await setup()
    expect(await s.publishers.get('fake')!.publish(req, new AbortController().signal)).toEqual({
      ok: false,
      code: 'auth'
    })
  })

  it('does not expose manual as a gate publisher and supports dry run', async () => {
    const s = await setup()
    expect(s.publishers.has('manual')).toBe(false)
    await s.fake.connect(s.credentials.contextFor('fake'))
    const r = await s.fake.publish(
      {
        projectId: 'p1',
        draftPath: 'a.md',
        contentHash: hash,
        title: 't',
        body,
        idempotencyKey: 'k'
      },
      s.credentials.contextFor('fake'),
      { dryRun: true }
    )
    expect(r).toEqual({ ok: true, dryRun: true })
    expect(s.fake.published).toHaveLength(0)
  })
})
