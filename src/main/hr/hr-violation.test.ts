import { mkdir, mkdtemp, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createMemoryStateStore } from '../gate/state-store'
import { SafeFs } from '../repository/safe-fs'
import { diffManifests, takeManifest } from './hr-manifest'
import { buildViolation, ViolationStore } from './hr-violation'

const dirs: string[] = []
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
})

async function setup(): Promise<{
  root: string
  store: ViolationStore
  record: (mutate: () => Promise<void>) => Promise<ReturnType<typeof buildViolation>>
}> {
  const root = await mkdtemp(join(tmpdir(), 'mc-viol-'))
  dirs.push(root)
  await mkdir(join(root, '.git'))
  const fs = await SafeFs.open(root)
  const store = new ViolationStore(createMemoryStateStore(), fs, (t) => t())
  return {
    root,
    store,
    record: async (mutate) => {
      const before = await takeManifest(fs.root)
      await mutate()
      const after = await takeManifest(fs.root)
      const rec = buildViolation(diffManifests(before, after), before, after, new Date())
      await store.save(rec)
      return rec
    }
  }
}

describe('violation restore', () => {
  it('restores an added binary file by removing it (no permanent stale)', async () => {
    const s = await setup()
    const rec = await s.record(() =>
      writeFile(join(s.root, 'blob.bin'), Buffer.from([0xff, 0xfe, 0]))
    )
    expect(await s.store.restore(rec.stateHash)).toEqual({ ok: true, restored: 1 })
    expect(await stat(join(s.root, 'blob.bin')).catch(() => null)).toBeNull()
  })

  it('treats an added symlink as not restorable instead of failing as stale', async () => {
    const s = await setup()
    const rec = await s.record(() => symlink('/etc', join(s.root, 'link')))
    expect(rec.files[0].before).toBe('unrestorable')
    expect(await s.store.restore(rec.stateHash)).toEqual({
      ok: false,
      code: 'not-restorable',
      files: ['link']
    })
  })

  it('refuses automatic restore when more than 200 files changed', async () => {
    const s = await setup()
    const rec = await s.record(async () => {
      for (let i = 0; i < 201; i++) await writeFile(join(s.root, `f${i}.txt`), 'x')
    })
    expect(rec.truncated).toBe(true)
    expect(rec.files).toHaveLength(200)
    expect(await s.store.restore(rec.stateHash)).toMatchObject({
      ok: false,
      code: 'not-restorable'
    })
    expect(await stat(join(s.root, 'f0.txt'))).toBeTruthy()
  })

  it('compares .git/config and hooks but not other git internals', async () => {
    const s = await setup()
    await mkdir(join(s.root, '.git/hooks'))
    const before = await takeManifest(s.root)
    await writeFile(join(s.root, '.git/config'), '[core]')
    await writeFile(join(s.root, '.git/hooks/pre-commit'), 'x')
    await writeFile(join(s.root, '.git/HEAD'), 'ref')
    expect(diffManifests(before, await takeManifest(s.root)).map((c) => c.path)).toEqual([
      '.git/config',
      '.git/hooks/pre-commit'
    ])
  })
})
