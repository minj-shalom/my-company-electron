import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, symlink, writeFile, truncate } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { verifyMedia } from './media-verifier'

const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex')
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('dummy-image')])
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom-dummy')])

let root: string
let outside: string
beforeEach(async () => {
  const base = await mkdtemp(join(tmpdir(), 'mc-media-'))
  root = join(base, 'out')
  outside = join(base, 'secret')
  await mkdir(join(root, 'sub'), { recursive: true })
  await mkdir(outside)
  await writeFile(join(root, 'a.png'), PNG)
  await writeFile(join(root, 'sub', 'v.mp4'), MP4)
  await writeFile(join(outside, 'x.png'), PNG)
})

const img = (path: string, b = PNG): { kind: 'image'; path: string; contentHash: string } => ({
  kind: 'image',
  path,
  contentHash: sha(b)
})

describe('verifyMedia', () => {
  it('accepts matching image and video and reports mime and size', async () => {
    const r = await verifyMedia(root, [
      img('a.png'),
      { kind: 'video', path: 'sub/v.mp4', contentHash: sha(MP4) }
    ])
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.media.map((m) => [m.mime, m.size])).toEqual([
        ['image/png', PNG.length],
        ['video/mp4', MP4.length]
      ])
    }
  })

  it('rejects a tampered file (hash mismatch)', async () => {
    await writeFile(join(root, 'a.png'), Buffer.concat([PNG, Buffer.from('x')]))
    expect(await verifyMedia(root, [img('a.png')])).toEqual({ ok: false, code: 'hash-mismatch' })
  })

  it('rejects path escapes and absolute paths', async () => {
    for (const p of ['../secret/x.png', '/etc/passwd.png', 'sub/../../secret/x.png', 'a//b.png'])
      expect(await verifyMedia(root, [img(p)])).toEqual({ ok: false, code: 'media-invalid' })
  })

  it('rejects a symlinked file and a symlinked directory', async () => {
    await symlink(join(outside, 'x.png'), join(root, 'link.png'))
    await symlink(outside, join(root, 'dir'))
    expect(await verifyMedia(root, [img('link.png')])).toMatchObject({ code: 'media-invalid' })
    expect(await verifyMedia(root, [img('dir/x.png')])).toMatchObject({ code: 'media-invalid' })
  })

  it('rejects oversized files', async () => {
    await writeFile(join(root, 'big.png'), PNG)
    await truncate(join(root, 'big.png'), 21 * 1024 * 1024)
    expect(await verifyMedia(root, [img('big.png', PNG)])).toMatchObject({ code: 'media-invalid' })
  })

  it('rejects MIME mismatch, kind mismatch, unknown extension and missing files', async () => {
    const fake = Buffer.from('<html>not an image</html>')
    await writeFile(join(root, 'fake.png'), fake)
    await writeFile(join(root, 'a.txt'), PNG)
    expect(await verifyMedia(root, [img('fake.png', fake)])).toMatchObject({
      code: 'media-invalid'
    })
    expect(await verifyMedia(root, [img('a.txt')])).toMatchObject({ code: 'media-invalid' })
    expect(
      await verifyMedia(root, [{ kind: 'video', path: 'a.png', contentHash: sha(PNG) }])
    ).toMatchObject({ code: 'media-invalid' })
    expect(await verifyMedia(root, [img('nope.png')])).toMatchObject({ code: 'media-invalid' })
  })

  it('rejects malformed hashes and too many items', async () => {
    expect(
      await verifyMedia(root, [{ kind: 'image', path: 'a.png', contentHash: 'ABC' }])
    ).toMatchObject({ code: 'media-invalid' })
    expect(await verifyMedia(root, Array(11).fill(img('a.png')))).toMatchObject({
      code: 'media-invalid'
    })
  })
})
