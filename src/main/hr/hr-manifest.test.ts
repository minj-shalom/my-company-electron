import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { diffManifests, takeManifest } from './hr-manifest'

const dirs: string[] = []
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
})
const root = async (): Promise<string> => {
  const d = await mkdtemp(join(tmpdir(), 'mc-mf-'))
  dirs.push(d)
  return d
}

describe('company manifest', () => {
  it('reports added, removed and modified files, including non-markdown ones', async () => {
    const r = await root()
    await mkdir(join(r, 'company/finance'), { recursive: true })
    await writeFile(join(r, 'company/finance/a.csv'), '1')
    await writeFile(join(r, 'keep.md'), 'k')
    await writeFile(join(r, 'gone.md'), 'g')
    const before = await takeManifest(r)
    await writeFile(join(r, 'company/finance/a.csv'), '2')
    await rm(join(r, 'gone.md'))
    await writeFile(join(r, 'new.bin'), Buffer.from([0xff, 0xfe, 0x00]))
    const after = await takeManifest(r)
    expect(diffManifests(before, after)).toEqual([
      { path: 'company/finance/a.csv', kind: 'modified' },
      { path: 'gone.md', kind: 'removed' },
      { path: 'new.bin', kind: 'added' }
    ])
    // 이진 파일은 복원용 본문을 담지 않는다.
    expect(after.entries.get('new.bin')?.text).toBeNull()
    expect(after.entries.get('keep.md')?.text).toBe('k')
  })

  it('ignores .git and node_modules and does not follow symlinks', async () => {
    const r = await root()
    const outside = await root()
    await writeFile(join(outside, 'secret.md'), 'outside')
    await mkdir(join(r, '.git'))
    await writeFile(join(r, '.git/HEAD'), 'x')
    await mkdir(join(r, 'node_modules/p'), { recursive: true })
    await writeFile(join(r, 'node_modules/p/i.js'), 'x')
    await symlink(outside, join(r, 'link'))
    const m = await takeManifest(r)
    expect([...m.entries.keys()]).toEqual(['link'])
    expect(m.entries.get('link')?.hash.startsWith('symlink:')).toBe(true)
    // 링크 대상이 바뀐 것은 변경으로 잡힌다.
    await rm(join(r, 'link'))
    await symlink(r, join(r, 'link'))
    expect(diffManifests(m, await takeManifest(r))).toEqual([{ path: 'link', kind: 'modified' }])
  })

  it('hashes files over the text limit without keeping their text', async () => {
    const r = await root()
    await writeFile(join(r, 'big.txt'), 'a'.repeat(300_000))
    const before = await takeManifest(r)
    expect(before.entries.get('big.txt')?.text).toBeNull()
    await writeFile(join(r, 'big.txt'), 'b'.repeat(300_000))
    expect(diffManifests(before, await takeManifest(r))).toEqual([
      { path: 'big.txt', kind: 'modified' }
    ])
  })
})
