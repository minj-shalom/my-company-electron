import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createCompanyFolder, validateCompanyName } from './scaffold'
import { COMPANY_DIRS, COMPANY_MARKER_FILES } from './templates'

let base: string
beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'mc-scaffold-'))
})
afterEach(async () => {
  await rm(base, { recursive: true, force: true })
})

describe('createCompanyFolder', () => {
  it('creates structure, marker files and employee templates', async () => {
    const r = await createCompanyFolder('Acme 회사', base)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    for (const d of COMPANY_DIRS)
      expect((await stat(join(r.companyDir, d))).isDirectory()).toBe(true)
    for (const f of COMPANY_MARKER_FILES)
      expect((await stat(join(r.companyDir, f))).isFile()).toBe(true)
    const agents = await readdir(join(r.companyDir, '.claude', 'agents'))
    expect(agents).toContain('developer.md')
    const dev = await readFile(join(r.companyDir, '.claude', 'agents', 'developer.md'), 'utf8')
    expect(dev).toMatch(/^---\nname: developer\ndescription: .+\ntools: .+\nmodel: .+\n---\n/)
    expect(await readFile(join(r.companyDir, 'CLAUDE.md'), 'utf8')).toContain('Acme 회사')
  })

  it('rejects an existing folder without touching it', async () => {
    await mkdir(join(base, 'Acme'))
    await writeFile(join(base, 'Acme', 'keep.txt'), 'x')
    const r = await createCompanyFolder('Acme', base)
    expect(r).toMatchObject({ ok: false, code: 'already-exists' })
    expect(await readdir(join(base, 'Acme'))).toEqual(['keep.txt'])
  })

  it('rejects an existing file and a symlink at the target', async () => {
    await writeFile(join(base, 'f'), 'x')
    expect(await createCompanyFolder('f', base)).toMatchObject({ code: 'already-exists' })
    const outside = await mkdtemp(join(tmpdir(), 'mc-outside-'))
    try {
      await symlink(outside, join(base, 'link'))
      expect(await createCompanyFolder('link', base)).toMatchObject({ code: 'already-exists' })
      expect(await readdir(outside)).toEqual([])
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })

  it('rejects path traversal, relative, missing and non-directory paths', async () => {
    expect(await createCompanyFolder('a', `${base}/..`)).toMatchObject({ code: 'invalid-path' })
    expect(await createCompanyFolder('a', `${base}/x/../`)).toMatchObject({ code: 'invalid-path' })
    expect(await createCompanyFolder('a', 'relative/dir')).toMatchObject({ code: 'invalid-path' })
    expect(await createCompanyFolder('a', join(base, 'nope'))).toMatchObject({
      code: 'invalid-path'
    })
    await writeFile(join(base, 'file'), 'x')
    expect(await createCompanyFolder('a', join(base, 'file'))).toMatchObject({
      code: 'invalid-path'
    })
    expect(await createCompanyFolder('a', 42)).toMatchObject({ code: 'invalid-path' })
  })

  it('rejects names that escape the parent', async () => {
    for (const n of ['../x', 'a/b', 'a\\b', '..', '.hidden']) {
      expect(await createCompanyFolder(n, base)).toMatchObject({ code: 'invalid-name' })
    }
    expect(await readdir(base)).toEqual([])
  })

  it('writes through a symlinked parent into its real location only', async () => {
    const real = join(base, 'real')
    await mkdir(real)
    await symlink(real, join(base, 'via'))
    const r = await createCompanyFolder('Co', join(base, 'via'))
    expect(r.ok).toBe(true)
    expect((await stat(join(real, 'Co'))).isDirectory()).toBe(true)
  })
})

describe('validateCompanyName', () => {
  it('accepts normal names and rejects bad ones', () => {
    expect(validateCompanyName('My Company')).toBeNull()
    expect(validateCompanyName('회사-1')).toBeNull()
    for (const bad of [
      '',
      ' a',
      'a ',
      'a.',
      'con',
      'NUL.txt',
      'a:b',
      'a'.repeat(51),
      'a\u0000b',
      1,
      null
    ])
      expect(validateCompanyName(bad)).not.toBeNull()
  })
})
