import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, parse } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  CompanyContext,
  NoCompanyError,
  createLastCompanyStore,
  nodeCompanyFs,
  type LastCompanyStore
} from './company-context'
import { CompanyService } from './company-service'
import { createCompanyFolder } from './scaffold'

let base: string
let userData: string
beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'mc-open-'))
  userData = join(base, 'userData')
  await mkdir(userData)
})
afterEach(async () => {
  await rm(base, { recursive: true, force: true })
})

function memoryStore(initial: string | null = null): LastCompanyStore & { saved: string | null } {
  const s = {
    saved: initial,
    load: async () => s.saved,
    save: async (p: string) => {
      s.saved = p
    }
  }
  return s
}

async function makeCompany(name = 'acme'): Promise<string> {
  const dir = join(base, name)
  await mkdir(join(dir, 'company'), { recursive: true })
  await writeFile(join(dir, 'CLAUDE.md'), '# c', 'utf8')
  await writeFile(join(dir, 'company', 'org.md'), '# org', 'utf8')
  return dir
}

/** 폴더의 모든 파일(경로, 내용)을 모아 열기 전후 비교에 쓴다. */
async function snapshot(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const ent of await readdir(dir, { withFileTypes: true, recursive: true })) {
    const p = join(ent.parentPath, ent.name)
    out.push(ent.isFile() ? `${p}:${await readFile(p, 'utf8')}` : p)
  }
  return out.sort()
}

describe('CompanyContext.open', () => {
  it('opens a folder with both markers, writes nothing, and remembers it', async () => {
    const dir = await makeCompany()
    const before = await snapshot(dir)
    const store = memoryStore()
    const ctx = new CompanyContext({ store })
    const r = await ctx.open(dir)
    expect(r.ok).toBe(true)
    expect(await snapshot(dir)).toEqual(before)
    expect(store.saved).not.toBeNull()
    expect(ctx.getOpenCompany()?.name).toBe('acme')
    expect(ctx.getState().status).toBe('open')
    expect(await ctx.requireOpenCompany().fs.exists('CLAUDE.md')).toBe(true)
  })

  it('rejects a folder without markers and names the missing ones', async () => {
    const dir = join(base, 'plain')
    await mkdir(dir)
    await writeFile(join(dir, 'CLAUDE.md'), 'x', 'utf8')
    const ctx = new CompanyContext({ store: memoryStore() })
    const r = await ctx.open(dir)
    expect(r).toMatchObject({ ok: false, code: 'not-company' })
    if (!r.ok) {
      expect(r.message).toContain('company/org.md')
      expect(r.message).not.toContain(base)
    }
    expect(ctx.getOpenCompany()).toBeNull()
    expect((await readdir(dir)).sort()).toEqual(['CLAUDE.md'])
  })

  it('resolves symlinks before judging markers', async () => {
    const real = await makeCompany('real')
    const link = join(base, 'link')
    await symlink(real, link)
    const ctx = new CompanyContext({ store: memoryStore() })
    const r = await ctx.open(link)
    expect(r.ok).toBe(true)
    expect(ctx.requireOpenCompany().name).toBe('real')

    const emptyTarget = join(base, 'empty')
    await mkdir(emptyTarget)
    const link2 = join(base, 'link2')
    await symlink(emptyTarget, link2)
    expect(await new CompanyContext({ store: memoryStore() }).open(link2)).toMatchObject({
      code: 'not-company'
    })
  })

  it('does not accept a marker file that is a symlink', async () => {
    const dir = await makeCompany('m')
    const outside = join(base, 'outside.md')
    await writeFile(outside, 'x', 'utf8')
    await rm(join(dir, 'CLAUDE.md'))
    await symlink(outside, join(dir, 'CLAUDE.md'))
    expect(await new CompanyContext({ store: memoryStore() }).open(dir)).toMatchObject({
      code: 'not-company'
    })
  })

  it('rejects missing, relative, traversal, file and non-string paths without leaking paths', async () => {
    const ctx = new CompanyContext({ store: memoryStore() })
    const gone = join(base, 'nope')
    const r = await ctx.open(gone)
    expect(r).toMatchObject({ ok: false, code: 'not-found' })
    if (!r.ok) expect(r.message).not.toContain(base)
    expect(await ctx.open('relative/dir')).toMatchObject({ code: 'invalid-path' })
    expect(await ctx.open(`${base}/a/../b`)).toMatchObject({ code: 'invalid-path' })
    expect(await ctx.open(`${base}\0x`)).toMatchObject({ code: 'invalid-path' })
    expect(await ctx.open(42)).toMatchObject({ code: 'invalid-request' })
    expect(await ctx.open('')).toMatchObject({ code: 'invalid-request' })
    const file = join(base, 'f.txt')
    await writeFile(file, 'x', 'utf8')
    expect(await ctx.open(file)).toMatchObject({ code: 'invalid-path' })
  })

  it('hides internal error details', async () => {
    const dir = await makeCompany()
    const ctx = new CompanyContext({
      store: memoryStore(),
      fs: {
        ...nodeCompanyFs,
        realpath: async () => {
          throw Object.assign(new Error(`EACCES ${dir}`), { code: 'EACCES' })
        }
      }
    })
    const r = await ctx.open(dir)
    expect(r).toMatchObject({ ok: false, code: 'open-failed' })
    if (!r.ok) expect(r.message).not.toContain(dir)
  })

  it('refuses to switch to a different company but allows reopening the same one', async () => {
    const a = await makeCompany('a')
    const b = await makeCompany('b')
    const ctx = new CompanyContext({ store: memoryStore() })
    expect((await ctx.open(a)).ok).toBe(true)
    expect(await ctx.open(b)).toMatchObject({ ok: false, code: 'already-open' })
    expect(ctx.requireOpenCompany().name).toBe('a')
    expect((await ctx.open(a)).ok).toBe(true)
  })

  it('does not fail the open when remembering fails', async () => {
    const dir = await makeCompany()
    const store = { load: async () => null, save: async () => Promise.reject(new Error('disk')) }
    expect((await new CompanyContext({ store }).open(dir)).ok).toBe(true)
  })

  it('requireOpenCompany throws when nothing is open', () => {
    expect(() => new CompanyContext({ store: memoryStore() }).requireOpenCompany()).toThrow(
      NoCompanyError
    )
  })
})

describe('last company restore', () => {
  it('reopens the remembered company on start', async () => {
    const dir = await makeCompany()
    const store = createLastCompanyStore(userData)
    await new CompanyContext({ store }).open(dir)
    // 회사 폴더 안이 아니라 userData에만 기억한다.
    expect(await readdir(userData)).toEqual(['last-company.json'])
    const next = new CompanyContext({ store: createLastCompanyStore(userData) })
    expect(await next.restoreLast()).toMatchObject({ status: 'open' })
    expect(next.getOpenCompany()?.name).toBe('acme')
  })

  it('reports none when nothing is remembered or the file is corrupt', async () => {
    const ctx = new CompanyContext({ store: createLastCompanyStore(userData) })
    expect(await ctx.restoreLast()).toEqual({ status: 'none' })
    await writeFile(join(userData, 'last-company.json'), '{not json', 'utf8')
    expect(
      await new CompanyContext({ store: createLastCompanyStore(userData) }).restoreLast()
    ).toEqual({
      status: 'none'
    })
    await writeFile(join(userData, 'last-company.json'), '{"path":"relative"}', 'utf8')
    expect(
      await new CompanyContext({ store: createLastCompanyStore(userData) }).restoreLast()
    ).toEqual({
      status: 'none'
    })
  })

  it('reports missing when the folder is gone and keeps the remembered path', async () => {
    const dir = await makeCompany()
    const store = createLastCompanyStore(userData)
    await new CompanyContext({ store }).open(dir)
    await rm(dir, { recursive: true })
    const ctx = new CompanyContext({ store })
    expect(await ctx.restoreLast()).toEqual({ status: 'missing', name: 'acme' })
    expect(ctx.getOpenCompany()).toBeNull()
    expect(await store.load()).not.toBeNull()
  })

  it('reports invalid when the markers disappeared', async () => {
    const dir = await makeCompany()
    const store = memoryStore(dir)
    await rm(join(dir, 'CLAUDE.md'))
    const state = await new CompanyContext({ store }).restoreLast()
    expect(state).toMatchObject({ status: 'invalid', name: 'acme' })
  })

  it('can open another company after a missing one and then remembers it', async () => {
    const store = memoryStore(join(base, 'gone'))
    const ctx = new CompanyContext({ store })
    expect((await ctx.restoreLast()).status).toBe('missing')
    const dir = await makeCompany('new')
    expect((await ctx.open(dir)).ok).toBe(true)
    expect(ctx.getState().status).toBe('open')
    expect(store.saved).toContain('new')
  })
})

describe('CompanyService path approval (D-005 B)', () => {
  const picker = (path: string | null) => async () => path

  it('rejects create and open for paths the dialog never returned', async () => {
    const ctx = new CompanyContext({ store: memoryStore() })
    const svc = new CompanyService({ context: ctx })
    expect(await svc.create({ name: 'x', path: base })).toMatchObject({
      ok: false,
      code: 'path-not-allowed'
    })
    const dir = await makeCompany()
    expect(await svc.open({ path: dir })).toMatchObject({ ok: false, code: 'path-not-allowed' })
    expect(ctx.getOpenCompany()).toBeNull()
    expect(await svc.create({ name: 'x', path: 5 })).toMatchObject({ code: 'path-not-allowed' })
    expect(await svc.create(null)).toMatchObject({ code: 'invalid-request' })
    expect(await svc.open('x')).toMatchObject({ code: 'invalid-request' })
  })

  it('keeps purposes separate', async () => {
    const svc = new CompanyService({ context: new CompanyContext({ store: memoryStore() }) })
    const dir = await makeCompany()
    expect(await svc.selectFolder('create-location', picker(dir))).toBe(dir)
    expect(await svc.open({ path: dir })).toMatchObject({ code: 'path-not-allowed' })
    await svc.selectFolder('open', picker(dir))
    expect((await svc.open({ path: dir })).ok).toBe(true)
  })

  it('allows only the picked location for create, then opens the created company', async () => {
    const ctx = new CompanyContext({ store: memoryStore() })
    const svc = new CompanyService({ context: ctx, createFolder: createCompanyFolder })
    const parent = join(base, 'parent')
    await mkdir(parent)
    expect(await svc.selectFolder('create-location', picker(parent))).toBe(parent)
    expect(await svc.create({ name: 'x', path: base })).toMatchObject({ code: 'path-not-allowed' })
    const created = await svc.create({ name: 'Acme', path: parent })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    expect((await stat(created.companyDir)).isDirectory()).toBe(true)
    const opened = await svc.open({ path: created.companyDir })
    expect(opened.ok).toBe(true)
    expect(svc.current()).toMatchObject({ status: 'open' })
  })

  it('treats a symlink to an approved folder as the same folder', async () => {
    const svc = new CompanyService({ context: new CompanyContext({ store: memoryStore() }) })
    const dir = await makeCompany()
    await svc.selectFolder('open', picker(dir))
    const link = join(base, 'alias')
    await symlink(dir, link)
    expect((await svc.open({ path: link })).ok).toBe(true)
  })

  it('returns null on cancel or a vanished selection and approves nothing', async () => {
    const svc = new CompanyService({ context: new CompanyContext({ store: memoryStore() }) })
    expect(await svc.selectFolder('open', picker(null))).toBeNull()
    expect(await svc.selectFolder('open', picker(join(base, 'gone')))).toBeNull()
  })

  it('validates the dialog purpose input', () => {
    expect(CompanyService.parsePurpose(undefined)).toBe('create-location')
    expect(CompanyService.parsePurpose('open')).toBe('open')
    expect(() => CompanyService.parsePurpose('../x')).toThrow()
    expect(() => CompanyService.parsePurpose({})).toThrow()
  })
})

describe('CompanyContext concurrency', () => {
  it('lets only one of two different concurrent opens succeed', async () => {
    const a = await makeCompany('a')
    const b = await makeCompany('b')
    const ctx = new CompanyContext({ store: memoryStore() })
    const results = await Promise.all([ctx.open(a), ctx.open(b)])
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(results.filter((r) => !r.ok && r.code === 'already-open')).toHaveLength(1)
    const winner = results.find((r) => r.ok)
    if (winner?.ok) expect(ctx.requireOpenCompany().name).toBe(winner.company.name)
  })

  it('treats concurrent opens of the same path as idempotent', async () => {
    const a = await makeCompany('a')
    const store = memoryStore()
    const ctx = new CompanyContext({ store })
    const results = await Promise.all([ctx.open(a), ctx.open(a), ctx.open(a)])
    expect(results.every((r) => r.ok)).toBe(true)
  })

  it('serializes open and restoreLast', async () => {
    const remembered = await makeCompany('remembered')
    const other = await makeCompany('other')
    const ctx = new CompanyContext({ store: memoryStore(remembered) })
    const [restored, opened] = await Promise.all([ctx.restoreLast(), ctx.open(other)])
    expect(restored.status).toBe('open')
    expect(opened).toMatchObject({ ok: false, code: 'already-open' })
    expect(ctx.requireOpenCompany().name).toBe('remembered')
  })
})

describe('CompanyContext extra validation', () => {
  it('rejects the filesystem root and the home directory', async () => {
    const home = await makeCompany('home')
    const ctx = new CompanyContext({ store: memoryStore(), homeDir: await realpath(home) })
    expect(await ctx.open(home)).toMatchObject({ ok: false, code: 'invalid-path' })
    expect(await ctx.open(parse(base).root)).toMatchObject({ ok: false, code: 'invalid-path' })
  })

  it('rejects a marker that is a directory', async () => {
    const dir = await makeCompany('d')
    await rm(join(dir, 'company', 'org.md'))
    await mkdir(join(dir, 'company', 'org.md'))
    expect(await new CompanyContext({ store: memoryStore() }).open(dir)).toMatchObject({
      code: 'not-company'
    })
  })

  it('shows permission errors on restore as invalid, not missing', async () => {
    const dir = await makeCompany('p')
    const denied = Object.assign(new Error(`EACCES ${dir}`), { code: 'EACCES' })
    const ctx = new CompanyContext({
      store: memoryStore(dir),
      fs: {
        ...nodeCompanyFs,
        isRegularFile: async () => {
          throw denied
        }
      }
    })
    const state = await ctx.restoreLast()
    expect(state).toMatchObject({ status: 'invalid', name: 'p' })
    expect(JSON.stringify(state)).not.toContain(base)
    const ctx2 = new CompanyContext({
      store: memoryStore(dir),
      fs: {
        ...nodeCompanyFs,
        realpath: async () => {
          throw denied
        }
      }
    })
    expect((await ctx2.restoreLast()).status).toBe('invalid')
  })

  it.each([
    ['dot-dot segment', JSON.stringify({ path: '/a/../b' })],
    ['NUL byte', JSON.stringify({ path: '/a\u0000b' })],
    ['over 1024 chars', JSON.stringify({ path: `/${'a'.repeat(1030)}` })],
    ['object path', JSON.stringify({ path: { x: 1 } })],
    ['array root', '[]'],
    ['null', 'null']
  ])('ignores a tampered last-company.json (%s)', async (_label, content) => {
    await writeFile(join(userData, 'last-company.json'), content, 'utf8')
    const ctx = new CompanyContext({ store: createLastCompanyStore(userData) })
    expect(await ctx.restoreLast()).toEqual({ status: 'none' })
  })
})

describe('CompanyService hardening', () => {
  const picker = (path: string | null) => async () => path

  it('drops the oldest approval after the cap of 8', async () => {
    const svc = new CompanyService({ context: new CompanyContext({ store: memoryStore() }) })
    const dirs: string[] = []
    for (let i = 0; i < 9; i++) {
      const d = await makeCompany(`c${i}`)
      dirs.push(d)
      await svc.selectFolder('open', picker(d))
    }
    expect(await svc.open({ path: dirs[0] })).toMatchObject({ code: 'path-not-allowed' })
    expect((await svc.open({ path: dirs[8] })).ok).toBe(true)
  })

  it('rejects a link swapped to another folder after selection (TOCTOU)', async () => {
    const good = await makeCompany('good')
    const evil = await makeCompany('evil')
    const link = join(base, 'swap')
    await symlink(good, link)
    const ctx = new CompanyContext({ store: memoryStore() })
    const svc = new CompanyService({ context: ctx })
    await svc.selectFolder('open', picker(link))
    await rm(link)
    await symlink(evil, link)
    expect(await svc.open({ path: link })).toMatchObject({ ok: false, code: 'path-not-allowed' })
    expect(ctx.getOpenCompany()).toBeNull()
  })

  it('passes the approved real path to create', async () => {
    const parent = join(base, 'parent')
    await mkdir(parent)
    const link = join(base, 'parent-link')
    await symlink(parent, link)
    const seen: unknown[] = []
    const svc = new CompanyService({
      context: new CompanyContext({ store: memoryStore() }),
      createFolder: async (_n, p) => {
        seen.push(p)
        return { ok: false, code: 'create-failed', message: 'x' }
      }
    })
    await svc.selectFolder('create-location', picker(link))
    await svc.create({ name: 'x', path: link })
    expect(seen).toEqual([await realpath(parent)])
  })

  it('shares one in-flight dialog per purpose', async () => {
    const svc = new CompanyService({ context: new CompanyContext({ store: memoryStore() }) })
    const dir = await makeCompany()
    let calls = 0
    let release: () => void = () => undefined
    const gate = new Promise<void>((r) => (release = r))
    const slow = async (): Promise<string> => {
      calls++
      await gate
      return dir
    }
    const p1 = svc.selectFolder('open', slow)
    const p2 = svc.selectFolder('open', slow)
    release()
    expect(await Promise.all([p1, p2])).toEqual([dir, dir])
    expect(calls).toBe(1)
    await svc.selectFolder('open', slow)
    expect(calls).toBe(2)
  })
})
