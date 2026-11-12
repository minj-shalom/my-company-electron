import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FsGuardError, MAX_FILE_BYTES, SafeFs } from './safe-fs'

let dir: string
let outside: string
let fs: SafeFs
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mc-sfs-'))
  outside = await mkdtemp(join(tmpdir(), 'mc-sfs-out-'))
  fs = await SafeFs.open(dir)
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
  await rm(outside, { recursive: true, force: true })
})

const kind = async (p: Promise<unknown>): Promise<string | undefined> =>
  p.then(
    () => undefined,
    (e) => (e instanceof FsGuardError ? e.kind : 'other')
  )

describe('SafeFs', () => {
  it('rejects traversal, NUL and absolute paths', async () => {
    expect(await kind(fs.readText('../x.md'))).toBe('escape')
    expect(await kind(fs.readText('a/../../x.md'))).toBe('escape')
    expect(await kind(fs.readText('a\0b.md'))).toBe('escape')
    expect(await kind(fs.readText(join(outside, 'x.md')))).toBe('escape')
    expect(await kind(fs.writeText('../x.md', 'x'))).toBe('escape')
  })

  it('rejects files over 1MB and directories', async () => {
    await writeFile(join(dir, 'big.md'), 'x'.repeat(MAX_FILE_BYTES + 1))
    await mkdir(join(dir, 'd.md'))
    expect(await kind(fs.readText('big.md'))).toBe('too-large')
    expect(await kind(fs.readText('d.md'))).toBe('not-file')
    expect(await kind(fs.readText('none.md'))).toBe('missing')
  })

  it('refuses to read a symlinked file', async () => {
    await writeFile(join(outside, 'x.md'), 'secret')
    await symlink(join(outside, 'x.md'), join(dir, 'x.md'))
    expect(await kind(fs.readText('x.md'))).toBe('symlink')
  })

  it('no-clobber write is exclusive and leaves no tmp files', async () => {
    await fs.writeText('a/n.md', 'one', false)
    expect(await kind(fs.writeText('a/n.md', 'two', false))).toBe('exists')
    await fs.writeText('a/n.md', 'three')
    expect(await fs.readText('a/n.md')).toBe('three')
    expect(await readdir(join(dir, 'a'))).toEqual(['n.md'])
  })

  it('concurrent no-clobber writes: exactly one wins', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => kind(fs.writeText('r.md', `v${i}`, false)))
    )
    expect(results.filter((r) => r === undefined)).toHaveLength(1)
    expect(results.filter((r) => r === 'exists')).toHaveLength(7)
    expect(await readdir(dir)).toEqual(['r.md'])
  })
})
