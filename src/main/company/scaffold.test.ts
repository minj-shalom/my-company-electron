import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createCompanyFolder, validateCompanyName } from './scaffold'
import { EMPLOYEE_TEMPLATES } from '../employee/templates'
import { loadOrg } from '../org/org-store'
import { SafeFs } from '../repository/safe-fs'
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
    // 기본 직원은 cto, cfo, hr 3명이다. pm과 developer는 인사팀을 통해 채용한다 (T-051).
    const agents = (await readdir(join(r.companyDir, '.claude', 'agents'))).sort()
    expect(agents).toEqual(['cfo.md', 'cto.md', 'hr.md'])
    const hr = await readFile(join(r.companyDir, '.claude', 'agents', 'hr.md'), 'utf8')
    expect(hr).toMatch(/^---\nname: hr\ndescription: .+\ntools: .+\nmodel: .+\n---\n/)
    expect(await readFile(join(r.companyDir, 'CLAUDE.md'), 'utf8')).toContain('Acme 회사')
  })

  it('writes an org.md the org parser reads with zero issues', async () => {
    const r = await createCompanyFolder('Acme', base)
    if (!r.ok) throw new Error('create failed')
    const org = await loadOrg(await SafeFs.open(r.companyDir))
    expect(org.issues).toEqual([])
    expect(org.members.map((m) => [m.title, m.agentId, m.department, m.reportsTo])).toEqual([
      ['CEO', null, '경영', null],
      ['COO', null, '경영', 'CEO'],
      ['CTO', 'cto', 'R&D', 'COO'],
      ['CFO', 'cfo', '재무', 'COO'],
      ['인사', 'hr', '인사팀', 'COO']
    ])
  })

  it('tells the COO what to do without pm and delegates HR with CEO approval for sensitive changes', async () => {
    const r = await createCompanyFolder('Acme', base)
    if (!r.ok) throw new Error('create failed')
    const claude = await readFile(join(r.companyDir, 'CLAUDE.md'), 'utf8')
    expect(claude).toContain('pm이 없으면 COO가 직접')
    expect(claude).toContain('인사')
    expect(claude).toContain('hr에 위임')
    expect(claude).toContain('CEO 승인 카드')
    expect(claude).not.toContain('developer')
  })

  it('writes cto, cfo and hr exactly as the template library defines them (tools, model, body)', async () => {
    const r = await createCompanyFolder('Acme', base)
    if (!r.ok) throw new Error('create failed')
    for (const id of ['cto', 'cfo', 'hr']) {
      const text = await readFile(join(r.companyDir, '.claude', 'agents', `${id}.md`), 'utf8')
      const t = EMPLOYEE_TEMPLATES.find((e) => e.id === id)
      expect(text.endsWith(`\n${t?.body.trim()}\n`), id).toBe(true)
      expect(text).toContain(`\ntools: ${t?.tools.join(', ')}\n`)
      expect(text).toContain(`\nmodel: ${t?.model}\n`)
    }
    const cto = await readFile(join(r.companyDir, '.claude', 'agents', 'cto.md'), 'utf8')
    expect(cto).toContain('\ntools: Read, Grep, Glob\n')
    const hr = await readFile(join(r.companyDir, '.claude', 'agents', 'hr.md'), 'utf8')
    expect(hr).toContain('\ntools: Read, Write, Edit, Grep, Glob\n')
    expect(hr).not.toMatch(/\ntools:.*Bash/)
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
