import { mkdir, mkdtemp, rm, rename, symlink, writeFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CacheStore } from './cache-store'
import { CachedCompanyRepository } from './cached-repository'
import { CompanyWatcher } from './company-watcher'
import { FileCompanyRepository } from '../repository/file-repository'
import { openCachedCompany, cacheDbPath, type CachedCompany } from './index'
import { MIGRATIONS, migrate } from './migrations'
import { classifyPath, relativeInside } from './watch-paths'

let dir: string
let outside: string
let dbPath: string
let open: CachedCompany[] = []
let watchers: CompanyWatcher[] = []

// 병렬 부하에서 파일 이벤트가 늦을 수 있어 폴링 대기 여유를 둔다.
vi.setConfig({ testTimeout: 20_000 })

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mc-cache-'))
  outside = await mkdtemp(join(tmpdir(), 'mc-cache-out-'))
  dbPath = join(outside, 'db', 'cache.sqlite')
})
afterEach(async () => {
  for (const w of watchers) await w.stop().catch(() => undefined)
  watchers = []
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
/**
 * 보초 파일을 새 이름으로 반복해 쓰며 조건이 참이 될 때까지 기다린다. 감시 시작 직후에는 방금 만든
 * 폴더의 감시가 늦게 붙어 첫 이벤트가 유실될 수 있어, 한 번만 쓰고 기다리면 간헐적으로 멈춘다.
 */
async function ping(
  relDir: string,
  done: () => Promise<boolean> | boolean,
  gapMs = 0
): Promise<void> {
  let n = 0
  let last = 0
  await until(async () => {
    if (await done()) return true
    // 디바운스보다 촘촘히 쓰면 flush가 계속 미뤄지므로 gapMs로 간격을 둔다.
    if (Date.now() - last >= gapMs) {
      last = Date.now()
      await put(`${relDir}/SENTINEL-${n++}.md`, '# s\n')
    }
    return false
  })
}

async function until(fn: () => Promise<boolean>, ms = 15_000): Promise<void> {
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

  it('rebuild restores the cache after the db file is deleted while running', async () => {
    // 실행 중 파일 삭제는 감지하지 않는다 (복구는 시작 시 rebuild와 명시적 rebuild).
    await seed()
    const c = await openIt()
    for (const suffix of ['', '-wal', '-shm']) await rm(dbPath + suffix, { force: true })
    await c.rebuild()
    expect(existsSync(dbPath)).toBe(true)
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
    expect(dirname(cacheDbPath('/u', '/c/one'))).toBe(join('/u', 'cache'))
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
    // 셋업 중 쓴 파일의 지연 이벤트를 먼저 소진한다 (보초 이벤트는 그 뒤에 온다). 지연 이벤트가
    // 수정과 겹치면 chokidar가 같은 mtime의 change를 걸러 내 수정이 반영되지 않는 경우가 있었다.
    await ping('company/reports', async () => (await c.repository.getReport('SENTINEL-0')).ok)
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

  /**
   * 감시자를 시작하고 셋업 중 쓴 파일의 뒤늦은 이벤트를 소진한다. macOS는 start 직전에 쓴 파일/링크
   * 이벤트를 ready 이후에도 전달한다 (ignoreInitial은 초기 스캔만 거른다. 부하에서 재현 확인).
   * 보초 파일의 이벤트가 도착한 뒤에 지연된 셋업 이벤트가 또 올 수 있으므로, 호출 수가 아니라
   * 원시 이벤트의 경로로 검사한다 (`raw`).
   */
  async function startWatcher(
    debounceMs: number
  ): Promise<{ calls: string[][]; raw: Array<string | null>; w: CompanyWatcher }> {
    const { realpath } = await import('node:fs/promises')
    const calls: string[][] = []
    const raw: Array<string | null> = []
    const w = new CompanyWatcher({
      root: await realpath(dir),
      debounceMs,
      onChange: async (k) => void calls.push(k),
      onRawEvent: (abs, rel) => void raw.push(rel === null ? `OUTSIDE:${abs}` : rel)
    })
    watchers.push(w)
    await w.start()
    return { calls, raw, w }
  }

  it('coalesces a burst of writes into few refreshes', async () => {
    await seed()
    const { calls } = await startWatcher(400)
    await ping('company/reports', () => calls.some((k) => k.includes('report')), 800)
    calls.length = 0
    for (let i = 0; i < 10; i++) await put(`company/reports/R-${i}.md`, `# R ${i}\n`)
    await until(async () => calls.length > 0)
    // 늦은 추가 flush가 없는지 보는 상한 검사라, 대기가 짧아도 거짓 실패는 나지 않는다.
    await new Promise((r) => setTimeout(r, 900))
    expect(calls.length).toBeLessThanOrEqual(2)
    expect(calls.flat()).toContain('report')
  })

  it('does not report outside paths or follow symlinks out', async () => {
    await seed()
    await mkdir(join(outside, 'ext'), { recursive: true })
    // 보초가 쓰일 폴더를 미리 만들어, 새 폴더 감시 시작 경쟁이 검사에 섞이지 않게 한다.
    await mkdir(join(dir, 'company/decisions/pending'), { recursive: true })
    try {
      await symlink(join(outside, 'ext'), join(dir, 'company/reports/linked'), 'dir')
    } catch (e) {
      // Windows는 권한 없이 symlink를 만들 수 없다.
      if ((e as NodeJS.ErrnoException).code === 'EPERM') return
      throw e
    }
    const { raw, calls } = await startWatcher(50)
    await writeFile(join(outside, 'ext', 'X.md'), '# x\n') // 링크 너머(밖)
    await put('src/note.md', '# n\n') // 관심 밖 폴더
    // 위 변경이 새어 나온다면 보초보다 먼저 도착한다. 보초가 보이면 검사한다.
    await ping('company/decisions/pending', () => calls.some((k) => k.includes('decision')))
    expect(
      raw.filter((p) => p !== null && (p.startsWith('OUTSIDE:') || /X\.md|note\.md/.test(p)))
    ).toEqual([])
  })

  it('rejects a second start', async () => {
    const { w } = await startWatcher(50)
    await expect(w.start()).rejects.toThrow()
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

describe('write path and filters', () => {
  async function build(prep?: () => Promise<void>): Promise<{
    repo: CachedCompanyRepository
    store: CacheStore
  }> {
    await seed()
    await prep?.()
    const source = await FileCompanyRepository.open(dir)
    const store = CacheStore.open(dbPath)
    const repo = new CachedCompanyRepository(source, store)
    await repo.rebuild()
    return { repo, store }
  }

  it('keeps the ok result when the cache refresh fails after a successful write', async () => {
    const { repo, store } = await build()
    vi.spyOn(store, 'replaceKind').mockImplementation(() => {
      throw Object.assign(new Error('disk full'), { code: 'SQLITE_FULL' })
    })
    const r = await repo.moveTicket('T-001', 'done')
    expect(r.ok).toBe(true)
    expect(existsSync(join(dir, 'company/tickets/done/T-001-a.md'))).toBe(true)
    vi.restoreAllMocks()
    // 코드 없는 오류도 삼킨다.
    vi.spyOn(store, 'replaceKind').mockImplementation(() => {
      throw new Error('boom')
    })
    expect((await repo.moveTicket('T-002', 'done')).ok).toBe(true)
    vi.restoreAllMocks()
    await repo.rebuild()
    expect((await repo.listTickets('done')).items).toHaveLength(2)
    store.close()
  })

  it('rebuilds on corruption during refresh and still returns the write result', async () => {
    const { repo, store } = await build()
    const real = store.replaceKind.bind(store)
    let thrown = false
    vi.spyOn(store, 'replaceKind').mockImplementation((...a) => {
      if (!thrown) {
        thrown = true
        throw Object.assign(new Error('corrupt'), { code: 'SQLITE_CORRUPT' })
      }
      real(...a)
    })
    const r = await repo.moveTicket('T-001', 'done')
    expect(r.ok).toBe(true)
    vi.restoreAllMocks()
    expect((await repo.listTickets('done')).items.map((t) => t.id)).toEqual(['T-001'])
    store.close()
  })

  it('scopes directory-level issues to their status and treats empty status as all', async () => {
    const { repo, store } = await build(async () => {
      // 링크 디렉터리는 SafeFs가 거부해 디렉터리 단위 이슈가 된다.
      await rm(join(dir, 'company/tickets/backlog'), { recursive: true })
      await mkdir(join(outside, 'real'))
      await symlink(join(outside, 'real'), join(dir, 'company/tickets/backlog'), 'dir')
    })
    expect((await repo.listTickets('in-progress')).issues).toEqual([])
    expect((await repo.listTickets('backlog')).issues.length).toBeGreaterThan(0)
    expect((await repo.listTickets('' as never)).items).toHaveLength(1)
    expect((await repo.listTickets('toString' as never)).items).toEqual([])
    store.close()
  })
})
