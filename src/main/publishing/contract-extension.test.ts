import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  GATE_ERROR_CODES,
  GATE_FAILURE_NOTES,
  PUBLISH_ERROR_CODES,
  type PublisherPublishResult
} from '../../shared/publisher'
import { CredentialService } from '../credentials/credential-service'
import { CredentialVault } from '../credentials/credential-vault'
import { SecretRegistry } from '../credentials/redact'
import { DUMMY_TOKEN, fakeSafeStorage } from '../credentials/test-helpers'
import type { PublishRequest, Publisher } from '../gate/publisher'
import { AdapterRegistry } from './adapter-registry'
import { createFakeAdapter, type FakeAdapter } from './fake-adapter'
import { createGatePublishers, GATE_CODE } from './gate-publisher'
import { createFileRecordStore, createMemoryRecordStore } from './publish-records'

const body = '# 제목\n\n본문\n'
const sha = (b: string | Buffer): string => createHash('sha256').update(b).digest('hex')
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('dummy')])
const base: PublishRequest = {
  projectId: 'p1',
  adapterId: 'fake',
  draftPath: 'a.md',
  draftHash: sha(body),
  idempotencyKey: 'key-1'
}
const sig = (): AbortSignal => new AbortController().signal

async function setup(
  script: () => Promise<PublisherPublishResult>,
  records = createMemoryRecordStore()
): Promise<{ fake: FakeAdapter; pub: Publisher; root: string }> {
  const fake = createFakeAdapter()
  const root = await mkdtemp(join(tmpdir(), 'mc-ce-'))
  fake.publish = async (r) => {
    fake.published.push(r)
    return script()
  }
  const registry = new AdapterRegistry([fake], ['fake'])
  const vault = new CredentialVault({
    userDataDir: root,
    safeStorage: fakeSafeStorage(),
    allowedAdapterIds: ['fake'],
    registry: new SecretRegistry()
  })
  const credentials = new CredentialService({
    vault,
    registry,
    openExternal: async () => undefined
  })
  const pub = createGatePublishers({
    registry,
    credentials,
    drafts: { read: async () => body, outputRoot: async () => root },
    records
  }).get('fake')!
  return { fake, pub, root }
}

afterEach(() => vi.restoreAllMocks())

describe('error codes reach the gate with display text', () => {
  it('maps the four new codes one-to-one and every gate code has a note', async () => {
    for (const c of ['quota', 'needs-review', 'media-invalid', 'pending'] as const) {
      expect(PUBLISH_ERROR_CODES).toContain(c)
      expect(GATE_CODE[c]).toBe(c)
      expect(GATE_FAILURE_NOTES[c].length).toBeGreaterThan(5)
    }
    for (const c of GATE_ERROR_CODES) expect(GATE_FAILURE_NOTES[c]).toBeTruthy()
  })

  it.each([
    ['quota', 'quota'],
    ['needs-review', 'needs-review'],
    ['media-invalid', 'media-invalid'],
    ['pending', 'pending']
  ] as const)('adapter %s becomes gate %s', async (code, gate) => {
    const s = await setup(async () => ({ ok: false, code }))
    expect(await s.pub.publish(base, sig())).toEqual({ ok: false, code: gate })
  })
})

describe('media through the gate', () => {
  it('passes verified media to the adapter and refuses a tampered file before calling it', async () => {
    const s = await setup(async () => ({ ok: true }))
    await mkdir(join(s.root, 'm'))
    await writeFile(join(s.root, 'm', 'a.png'), PNG)
    const media = [{ kind: 'image' as const, path: 'm/a.png', contentHash: sha(PNG) }]
    expect(await s.pub.publish({ ...base, media }, sig())).toEqual({ ok: true })
    expect(s.fake.published[0]?.media?.[0]).toMatchObject({ mime: 'image/png', size: PNG.length })

    await writeFile(join(s.root, 'm', 'a.png'), Buffer.concat([PNG, Buffer.from('!')]))
    const n = s.fake.published.length
    expect(await s.pub.publish({ ...base, idempotencyKey: 'key-2', media }, sig())).toEqual({
      ok: false,
      code: 'rejected'
    })
    expect(s.fake.published).toHaveLength(n)
  })

  it('maps invalid media to media-invalid', async () => {
    const s = await setup(async () => ({ ok: true }))
    const media = [{ kind: 'image' as const, path: '../x.png', contentHash: sha('x') }]
    expect(await s.pub.publish({ ...base, media }, sig())).toEqual({
      ok: false,
      code: 'media-invalid'
    })
    expect(s.fake.published).toHaveLength(0)
  })
})

describe('idempotency and confirm-required', () => {
  it('does not publish twice for the same key after success', async () => {
    const s = await setup(async () => ({ ok: true }))
    expect(await s.pub.publish(base, sig())).toEqual({ ok: true })
    expect(await s.pub.publish(base, sig())).toEqual({ ok: true })
    expect(s.fake.published).toHaveLength(1)
  })

  it('allows retry after a definite failure', async () => {
    let n = 0
    const s = await setup(async () => (n++ === 0 ? { ok: false, code: 'quota' } : { ok: true }))
    expect(await s.pub.publish(base, sig())).toMatchObject({ ok: false })
    expect(await s.pub.publish(base, sig())).toEqual({ ok: true })
    expect(s.fake.published).toHaveLength(2)
  })

  it('marks confirm-required after a timeout or throw and never retries automatically', async () => {
    const s = await setup(async () => {
      throw new Error('timeout')
    })
    expect(await s.pub.publish(base, sig())).toEqual({ ok: false, code: 'confirm-required' })
    expect(await s.pub.publish(base, sig())).toEqual({ ok: false, code: 'confirm-required' })
    expect(s.fake.published).toHaveLength(1)
    expect(GATE_FAILURE_NOTES['confirm-required']).toContain('발행 확인 필요')
  })

  it('treats network errors and pending as unresolved', async () => {
    const net = await setup(async () => ({ ok: false, code: 'network' }))
    expect(await net.pub.publish(base, sig())).toEqual({ ok: false, code: 'confirm-required' })
    await net.pub.publish(base, sig())
    expect(net.fake.published).toHaveLength(1)
    const pend = await setup(async () => ({ ok: false, code: 'pending' }))
    expect(await pend.pub.publish(base, sig())).toEqual({ ok: false, code: 'pending' })
    await pend.pub.publish(base, sig())
    expect(pend.fake.published).toHaveLength(1)
  })

  it('does not call twice concurrently and survives restart via the file store', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mc-rec-'))
    const file = join(dir, 'records.json')
    const s = await setup(
      async () => {
        await new Promise((r) => setTimeout(r, 20))
        return { ok: true }
      },
      await createFileRecordStore(file)
    )
    await Promise.all([s.pub.publish(base, sig()), s.pub.publish(base, sig())])
    expect(s.fake.published).toHaveLength(1)
    const again = await setup(async () => ({ ok: true }), await createFileRecordStore(file))
    expect(await again.pub.publish(base, sig())).toEqual({ ok: true })
    expect(again.fake.published).toHaveLength(0)
    expect(await readFile(file, 'utf8')).not.toContain('key-1')
  })
})

describe('no credential strings in logs or errors', () => {
  it('keeps the dummy token out of outputs, records and console', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined)
    )
    const dir = await mkdtemp(join(tmpdir(), 'mc-scan-'))
    const file = join(dir, 'records.json')
    const s = await setup(
      async () => {
        throw new Error(`boom ${DUMMY_TOKEN}`)
      },
      await createFileRecordStore(file)
    )
    const outs = [await s.pub.publish(base, sig()), await s.pub.publish(base, sig())]
    const seen = JSON.stringify([
      outs,
      spies.map((x) => x.mock.calls),
      await readFile(file, 'utf8')
    ])
    expect(seen).not.toContain(DUMMY_TOKEN)
    expect(seen).not.toContain('boom')
  })
})
