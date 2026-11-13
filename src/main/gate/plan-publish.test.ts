import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { fsDraftReader, checkDraftPath, type DraftReader } from './draft-reader'
import { makeKit, policyState, type Kit } from './gate-test-kit'
import { createPlanPublish } from './plan-publish'
import { createFakePublisher, type Publisher } from './publisher'

const kits: Kit[] = []
afterEach(async () => {
  for (const k of kits.splice(0)) await k.cleanup()
})

const drafts: DraftReader = {
  read: async (_d, _o, rel) => (rel === 'post.md' ? { hash: 'c'.repeat(64) } : null)
}

async function publishKit(
  publishers: Publisher[],
  policy = policyState({ publish: 'auto', limits: { publish: 2 } })
): Promise<Kit> {
  const k = await makeKit({
    planners: {
      publish: createPlanPublish({
        publishers: new Map(publishers.map((p) => [p.id, p])),
        drafts
      })
    }
  })
  kits.push(k)
  k.policy.value = policy
  return k
}
const pub = (k: Kit, draft: unknown = 'post.md') => k.svc.call(k.ctx, 'gate_publish', { draft })

describe('gate_publish', () => {
  it('auto publishes through the injected adapter once and audits it', async () => {
    const fake = createFakePublisher()
    const k = await publishKit([fake])
    expect((await pub(k)).status).toBe('executed')
    expect(fake.requests).toHaveLength(1)
    expect(fake.requests[0]).toMatchObject({ adapterId: 'fake', draftPath: 'post.md' })
    expect((await pub(k)).status).toBe('duplicate')
    expect(fake.requests).toHaveLength(1)
  })

  it('every mode, manual adapter, or missing adapter makes a content-approval card only', async () => {
    for (const [policy, adapters] of [
      [policyState({ publish: 'every' }), [createFakePublisher()]],
      [
        policyState({ publish: 'auto', limits: { publish: 2 }, adapter: 'manual' }),
        [createFakePublisher()]
      ],
      [
        policyState({ publish: 'auto', limits: { publish: 2 }, adapter: 'other' }),
        [createFakePublisher()]
      ]
    ] as const) {
      const k = await publishKit([...adapters], policy)
      const r = await pub(k)
      expect(r.status).toBe('card')
      expect(adapters[0].requests).toHaveLength(0)
    }
  })

  it('failure is recorded once with a card and never retried; limit applies', async () => {
    const bad = createFakePublisher('fake', { ok: false, code: 'network' })
    const k = await publishKit([bad])
    expect((await pub(k)).status).toBe('failed')
    expect((await pub(k)).status).toBe('blocked')
    expect(bad.requests).toHaveLength(1)

    const ok = createFakePublisher()
    const k2 = await publishKit([ok], policyState({ publish: 'auto', limits: { publish: 1 } }))
    expect((await pub(k2)).status).toBe('executed')
    expect((await k2.svc.call(k2.ctx, 'gate_publish', { draft: 'other.md' })).status).toBe(
      'blocked'
    )
  })

  it('kill switch and PM-required both fall back to a card', async () => {
    const fake = createFakePublisher()
    const k = await publishKit([fake])
    await k.killSwitch.set({ scope: 'company', engaged: true })
    expect((await pub(k)).status).toBe('card')
    await k.killSwitch.set({ scope: 'company', engaged: false })
    k.project.state = 'pm-required'
    expect((await pub(k)).status).toBe('card')
    expect(fake.requests).toHaveLength(0)
  })

  it('rejects bad input, unknown keys and missing drafts', async () => {
    const k = await publishKit([createFakePublisher()])
    for (const d of ['../x.md', '/etc/passwd', 'a.txt', 'nope.md'])
      expect((await pub(k, d)).status).toBe('blocked')
    expect((await k.svc.call(k.ctx, 'gate_publish', { draft: 'post.md', token: 'x' })).status).toBe(
      'blocked'
    )
  })
})

describe('fsDraftReader', () => {
  it('hashes drafts inside the output dir and refuses symlink escapes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mc-draft-'))
    const outside = await mkdtemp(join(tmpdir(), 'mc-draft-out-'))
    try {
      await mkdir(join(root, 'drafts'))
      await writeFile(join(root, 'drafts/a.md'), 'hello')
      await writeFile(join(outside, 'secret.md'), 'x')
      await symlink(join(outside, 'secret.md'), join(root, 'drafts/link.md'))
      await symlink(outside, join(root, 'drafts/dir'))
      expect((await fsDraftReader.read(root, 'drafts', 'a.md'))?.hash).toMatch(/^[0-9a-f]{64}$/)
      expect(await fsDraftReader.read(root, 'drafts', 'link.md')).toBeNull()
      expect(await fsDraftReader.read(root, 'drafts', 'dir/secret.md')).toBeNull()
      expect(await fsDraftReader.read(root, '../x', 'a.md')).toBeNull()
      expect(checkDraftPath('a/b.md')).toBe(true)
      expect(checkDraftPath('a/../b.md')).toBe(false)
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(outside, { recursive: true, force: true })
    }
  })
})
