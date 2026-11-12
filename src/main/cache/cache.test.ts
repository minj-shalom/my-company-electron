import { mkdir, mkdtemp, rm, rename, symlink, writeFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CacheStore } from './cache-store'
import { openCachedCompany, cacheDbPath, type CachedCompany } from './index'
import { MIGRATIONS, migrate } from './migrations'
import { classifyPath, relativeInside } from './watch-paths'

let dir: string
let outside: string
let dbPath: string
let open: CachedCompany[] = []

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mc-cache-'))
  outside = await mkdtemp(join(tmpdir(), 'mc-cache-out-'))
  dbPath = join(outside, 'db', 'cache.sqlite')
})
afterEach(async () => {
  for (const c of open) await c.close().catch(() => undefined)
  open = []
  await rm(dir, { recursive: true, force: true })
  await rm(outside, { recursive: true, force: true })
})

async function put(rel: string, content: string): Promise<void> {
  const abs = join(dir, rel)
  await mkdir(dirname(abs), { recursive: true })
  await writeFile(abs, content)
}
const ticket = (n: number, status: string, title = '제목'): string =>
  `# T-00${n}: ${title}\n\n- **상태:** ${status}\n- **담당:** developer\n\n## 목표\n본문\n`
const agent = (n: string): string => `---\nname: ${n}\ndescription: ${n} 설명\n---\n\n# ${n}\n`

async function seed(): Promise<void> {
  await put('company/tickets/backlog/T-001-a.md', ticket(1, 'backlog'))
  await put('company/tickets/in-progress/T-002-b.md', ticket(2, 'in-progress'))
  await put('company/reports/T-001-a.md', '# T-001 보고\n내용\n')
  await put('.claude/agents/developer.md', agent('developer'))
}
async function openIt(watch = false, debounceMs = 30): Promise<CachedCompany> {
  const c = await openCachedCompany({ companyDir: dir, dbPath, watch, debounceMs })
  open.push(c)
  return c
}
async function until(fn: () => Promise<boolean>, ms = 5000): Promise<void> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await fn()) return
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error('timeout')
}

describe('rebuild and read from cache', () => {
  it('fills the cache from the folder and serves reads from it', async () => {
    await seed()
    const c = await openIt()
    expect((await c.repository.listTickets()).items.map((t) => t.id)).toEqual(['T-001', 'T-002'])
    expect((await c.repository.listTickets('backlog')).items).toHaveLength(1)
    expect((await c.repository.getTicket('T-002')).ok).toBe(true)
    expect((await c.repository.listReports()).items).toHaveLength(1)
    expect((await c.repository.listEmployees()).org.employees.map((e) => e.id)).toContain(
      'developer'
    )
    // 파일을 직접 고쳐도 감시 없이는 캐시가 그대로 -> 읽기가 캐시에서 나옴을 증명한다.
    await put('company/tickets/backlog/T-001-a.md', ticket(1, 'backlog', '바뀜'))
    const t = await c.repository.getTicket('T-001')
    expect(t.ok && t.value.title).toBe('제목')
    await c.rebuild()
    const t2 = await c.repository.getTicket('T-001')
    expect(t2.ok && t2.value.title).toBe('바뀜')
  })

  it('keeps parse issues and unknown ids behave like the file repository', async () => {
    await seed()
    await put('company/tickets/backlog/T-009-bad.md', '\0\0')
    const c = await openIt()
    const l = await c.repository.listTickets()
    expect(l.items.length + l.issues.length).toBeGreaterThanOrEqual(2)
    const bad = await c.repository.getTicket('../x')
    expect(bad.ok === false && bad.code).toBe('invalid-request')
    const nf = await c.repository.getTicket('T-777')
    expect(nf.ok === false && nf.code).toBe('not-found')
  })

  it('writes go to files first and then refresh the cache', async () => {
    await seed()
    const c = await openIt()
    const r = await c.repository.moveTicket('T-001', 'done')
    expect(r.ok && r.value.status).toBe('done')
    expect(existsSync(join(dir, 'company/tickets/done/T-001-a.md'))).toBe(true)
    expect((await c.repository.listTickets('done')).items.map((t) => t.id)).toEqual(['T-001'])
    expect((await c.repository.listTickets('backlog')).items).toHaveLength(0)
  })
})

describe('recovery', () => {
  it('recovers when the db file is deleted', async () => {
    await seed()
    const c = await openIt()
    await c.close()
    open = []
    await rm(dbPath, { force: true })
    await rm(dbPath + '-wal', { force: true })
    await rm(dbPath + '-shm', { force: true })
    const c2 = await openIt()
    expect((await c2.repository.listTickets()).items).toHaveLength(2)
  })

  it('recovers from a corrupt db file at open', async () => {
    await seed()
    await mkdir(dirname(dbPath), { recursive: true })
    await writeFile(dbPath, Buffer.alloc(8192, 0x41))
    const c = await openIt()
    expect((await c.repository.listTickets()).items).toHaveLength(2)
  })

  it('recovers when the db is emptied while running (unpopulated cache refills)', async () => {
    await seed()
    const c = await openIt()
    const store = CacheStore.open(dbPath)
    store.reset() // 다른 핸들이 파일을 갈아엎는 상황
    store.close()
    // 열린 핸들이 가리키는 파일이 사라졌어도 읽기는 예외 없이 끝나야 한다.
    const l = await c.repository.listTickets()
    expect(Array.isArray(l.items)).toBe(true)
    await c.rebuild()
    expect((await c.repository.listTickets()).items).toHaveLength(2)
  })

  it('recovers from a row with broken JSON by rebuilding', async () => {
    await seed()
    const c = await openIt()
    const raw = new Database(dbPath)
    raw.prepare("UPDATE entries SET data = ? WHERE kind = 'ticket'").run('{not json')
    raw.close()
    const l = await c.repository.listTickets()
    expect(l.items.map((t) => t.id)).toEqual(['T-001', 'T-002'])
  })

  it('resets a db that is newer than this app', async () => {
    await seed()
    await mkdir(dirname(dbPath), { recursive: true })
    const raw = new Database(dbPath)
    raw.pragma('user_version = 999')
    raw.close()
    const c = await openIt()
    expect((await c.repository.listTickets()).items).toHaveLength(2)
    const check = new Database(dbPath, { readonly: true })
    expect(check.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length)
    check.close()
  })
})

describe('migrations', () => {
  it('applies steps in order and records user_version', () => {
    const db = new Database(':memory:')
    expect(migrate(db, ['CREATE TABLE a (x)'])).toBe('ok')
    expect(db.pragma('user_version', { simple: true })).toBe(1)
    expect(migrate(db, ['CREATE TABLE a (x)', 'ALTER TABLE a ADD COLUMN y'])).toBe('ok')
    expect(db.pragma('user_version', { simple: true })).toBe(2)
    expect(db.prepare('PRAGMA table_info(a)').all()).toHaveLength(2)
    expect(migrate(db, [])).toBe('too-new')
    db.close()
  })

  it('rolls a failing step back', () => {
    const db = new Database(':memory:')
    expect(() => migrate(db, ['CREATE TABLE a (x)', 'THIS IS NOT SQL'])).toThrow()
    expect(db.pragma('user_version', { simple: true })).toBe(1)
    db.close()
  })

  it('cacheDbPath is stable and outside the company dir', () => {
    expect(cacheDbPath('/u', '/c/one')).toBe(cacheDbPath('/u', '/c/one'))
    expect(cacheDbPath('/u', '/c/one')).not.toBe(cacheDbPath('/u', '/c/two'))
    expect(cacheDbPath('/u', '/c/one').startsWith('/u/cache/')).toBe(true)
  })
})

describe('classifyPath', () => {
  it('maps folder paths to cache kinds and ignores the rest', () => {
    expect(classifyPath('company/tickets/backlog/T-001.md')).toBe('ticket')
    expect(classifyPath('company/tickets/backlog')).toBe('ticket')
    expect(classifyPath('company/tickets/other/T-001.md')).toBeNull()
    expect(classifyPath('company/decisions/pending/D-001.md')).toBe('decision')
    expect(classifyPath('company/reports/R.md')).toBe('report')
    expect(classifyPath('company/reports/R.md.123.tmp')).toBeNull()
    expect(classifyPath('company/org.md')).toBe('org')
    expect(classifyPath('.claude/agents/dev.md')).toBe('org')
    expect(classifyPath('.claude/agents/sub/dev.md')).toBeNull()
    expect(classifyPath('node_modules/x.md')).toBeNull()
    expect(classifyPath('company/mission.md')).toBeNull()
  })
  it('rejects paths outside root', () => {
    expect(relativeInside('/r', '/r/a/b')).toBe('a/b')
    expect(relativeInside('/r', '/x/a')).toBeNull()
    expect(relativeInside('/r', '/r/../x')).toBeNull()
  })
})

describe('watcher', () => {
  it('reflects external edits, adds, moves and deletes (debounced)', async () => {
    await seed()
    const c = await openIt(true)
    await put('company/tickets/backlog/T-001-a.md', ticket(1, 'backlog', '외부 수정'))
    await until(async () => {
      const t = await c.repository.getTicket('T-001')
      return t.ok && t.value.title === '외부 수정'
    })
    await put('company/tickets/backlog/T-003-c.md', ticket(3, 'backlog', '새 티켓'))
    await until(async () => (await c.repository.getTicket('T-003')).ok)
    await mkdir(join(dir, 'company/tickets/done'), { recursive: true })
    await rename(
      join(dir, 'company/tickets/backlog/T-003-c.md'),
      join(dir, 'company/tickets/done/T-003-c.md')
    )
    await until(async () => {
      const t = await c.repository.getTicket('T-003')
      return t.ok && t.value.status === 'done'
    })
    await rm(join(dir, 'company/tickets/done/T-003-c.md'))
    await until(async () => !(await c.repository.getTicket('T-003')).ok)
  })

  it('coalesces a burst of writes into few refreshes', async () => {
    await seed()
    const calls: string[][] = []
    const { CompanyWatcher } = await import('./company-watcher')
    const { realpath } = await import('node:fs/promises')
    const w = new CompanyWatcher({
      root: await realpath(dir),
      debounceMs: 200,
      onChange: async (k) => void calls.push(k)
    })
    await w.start()
    for (let i = 0; i < 10; i++) await put(`company/reports/R-${i}.md`, `# R ${i}\n`)
    await until(async () => calls.length > 0)
    await new Promise((r) => setTimeout(r, 500))
    await w.stop()
    expect(calls.length).toBeLessThanOrEqual(2)
    expect(calls.flat()).toContain('report')
  })

  it('ignores files outside the watched tree and does not follow symlinks out', async () => {
    await seed()
    const calls: string[][] = []
    const { CompanyWatcher } = await import('./company-watcher')
    const { realpath } = await import('node:fs/promises')
    await mkdir(join(outside, 'ext'), { recursive: true })
    await symlink(join(outside, 'ext'), join(dir, 'company/reports/linked'))
    const w = new CompanyWatcher({
      root: await realpath(dir),
      debounceMs: 50,
      onChange: async (k) => void calls.push(k)
    })
    await w.start()
    await writeFile(join(outside, 'ext', 'X.md'), '# x\n') // 링크 너머(밖)
    await put('src/note.md', '# n\n') // 관심 밖 폴더
    await put('company/tickets/backlog/T-004.md.tmp', 'x') // 임시 파일
    await new Promise((r) => setTimeout(r, 600))
    await w.stop()
    expect(calls).toEqual([])
  })

  it('keeps cache consistent after rebuild when edits happened while closed', async () => {
    await seed()
    const c = await openIt()
    await c.close()
    open = []
    await put('company/tickets/backlog/T-005-late.md', ticket(5, 'backlog', '닫힌 동안'))
    const c2 = await openIt()
    expect((await c2.repository.getTicket('T-005')).ok).toBe(true)
    expect(await readFile(dbPath).then((b) => b.length)).toBeGreaterThan(0)
  })
})
