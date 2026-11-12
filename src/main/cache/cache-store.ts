import Database from 'better-sqlite3'
import { mkdirSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import { MIGRATIONS, migrate } from './migrations'

export type EntryKind = 'org' | 'ticket' | 'decision' | 'report'

export interface EntryRow {
  id: string
  status?: string
  title?: string
  /** JSON으로 직렬화된 도메인 객체. */
  data: unknown
}

export interface IssueRow {
  scope?: string
  path: string
  message: string
}

/** 캐시 내용이 읽을 수 없는 상태 (DB 손상 또는 행 JSON 손상). 호출자는 reset 후 재생성한다. */
export class CacheCorruptError extends Error {}

const CORRUPT_CODES = new Set([
  'SQLITE_CORRUPT',
  'SQLITE_NOTADB',
  'SQLITE_CANTOPEN',
  'SQLITE_IOERR',
  'SQLITE_FULL'
])

export function isCorruption(e: unknown): boolean {
  if (e instanceof CacheCorruptError) return true
  const code = (e as { code?: unknown } | null)?.code
  return typeof code === 'string' && (CORRUPT_CODES.has(code) || code.startsWith('SQLITE_CORRUPT'))
}

function removeDbFiles(path: string): void {
  for (const suffix of ['', '-wal', '-shm', '-journal'])
    rmSync(path + suffix, { force: true, maxRetries: 2 })
}

/**
 * SQLite 캐시 파일 하나를 감싼다. 원본은 항상 마크다운이므로 열기에 실패하거나 손상되면
 * 파일을 지우고 빈 DB로 다시 시작한다 (호출자가 폴더에서 rebuild). SQL은 모두 파라미터 바인딩이다.
 */
export class CacheStore {
  /** reset 중 재오픈에 실패하면 null. 이후 접근은 CacheCorruptError라 호출자가 reset을 다시 시도한다. */
  private handle: Database.Database | null

  private constructor(
    private readonly path: string,
    private readonly migrations: readonly string[],
    db: Database.Database
  ) {
    this.handle = db
  }

  private get db(): Database.Database {
    if (!this.handle) throw new CacheCorruptError('cache is not open')
    return this.handle
  }

  /** `path`가 ':memory:'가 아니면 상위 폴더를 만든다. 열기/검증/마이그레이션 중 어떤 오류든 DB를 새로 만든다. */
  static open(path: string, migrations: readonly string[] = MIGRATIONS): CacheStore {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    return new CacheStore(path, migrations, CacheStore.openFresh(path, migrations))
  }

  private static openFresh(path: string, migrations: readonly string[]): Database.Database {
    for (let attempt = 0; ; attempt++) {
      let db: Database.Database | null = null
      try {
        db = new Database(path)
        const check = db.pragma('quick_check', { simple: true })
        if (check !== 'ok') throw new CacheCorruptError('quick_check failed')
        if (migrate(db, migrations) === 'too-new') throw new CacheCorruptError('schema too new')
        // 캐시라 내구성보다 속도가 중요하다. 충돌 시 손상되면 위 경로가 재생성한다.
        db.pragma('journal_mode = WAL')
        db.pragma('synchronous = NORMAL')
        return db
      } catch (e) {
        db?.close()
        // 한 번 지우고도 실패하면 디스크/권한 문제라 그대로 던진다.
        if (attempt > 0 || path === ':memory:') throw e
        removeDbFiles(path)
      }
    }
  }

  /** DB 파일을 지우고 빈 스키마로 다시 연다. 데이터는 `rebuild`가 채운다. */
  reset(): void {
    try {
      this.handle?.close()
    } catch {
      // 손상된 핸들은 닫기에 실패할 수 있다. 어차피 파일을 지운다.
    }
    this.handle = null
    if (this.path !== ':memory:') removeDbFiles(this.path)
    this.handle = CacheStore.openFresh(this.path, this.migrations)
  }

  close(): void {
    this.handle?.close()
    this.handle = null
  }

  get schemaVersion(): number {
    return this.db.pragma('user_version', { simple: true }) as number
  }

  /** 한 종류의 행과 이슈를 트랜잭션으로 통째로 교체한다 (도중 실패하면 이전 상태 유지). */
  replaceKind(kind: EntryKind, entries: EntryRow[], issues: IssueRow[]): void {
    const delEntries = this.db.prepare('DELETE FROM entries WHERE kind = ?')
    const delIssues = this.db.prepare('DELETE FROM issues WHERE kind = ?')
    const ins = this.db.prepare(
      'INSERT INTO entries (kind, id, status, sort_key, title, data) VALUES (?, ?, ?, ?, ?, ?)'
    )
    const insIssue = this.db.prepare(
      'INSERT INTO issues (kind, scope, path, message) VALUES (?, ?, ?, ?)'
    )
    const setMeta = this.db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)')
    this.db.transaction(() => {
      delEntries.run(kind)
      delIssues.run(kind)
      // sort_key는 원본 Repository가 돌려준 순서(index)다. 정렬 규칙을 SQL로 다시 구현하지 않는다.
      entries.forEach((e, i) =>
        ins.run(kind, e.id, e.status ?? '', i, e.title ?? '', JSON.stringify(e.data))
      )
      for (const i of issues) insIssue.run(kind, i.scope ?? '', i.path, i.message)
      setMeta.run(`refreshed:${kind}`, new Date().toISOString())
    })()
  }

  /** 이 종류가 한 번이라도 채워졌는지 (reset 직후에는 false). */
  isPopulated(kind: EntryKind): boolean {
    const row = this.db.prepare('SELECT 1 AS x FROM meta WHERE key = ?').get(`refreshed:${kind}`)
    return row !== undefined
  }

  list(kind: EntryKind, status?: string): unknown[] {
    const rows = (
      status === undefined
        ? this.db.prepare('SELECT data FROM entries WHERE kind = ? ORDER BY sort_key').all(kind)
        : this.db
            .prepare('SELECT data FROM entries WHERE kind = ? AND status = ? ORDER BY sort_key')
            .all(kind, status)
    ) as Array<{ data: string }>
    return rows.map((r) => parseData(r.data))
  }

  get(kind: EntryKind, id: string): unknown | undefined {
    const row = this.db
      .prepare('SELECT data FROM entries WHERE kind = ? AND id = ? ORDER BY sort_key LIMIT 1')
      .get(kind, id) as { data: string } | undefined
    return row ? parseData(row.data) : undefined
  }

  /** `scope`를 주면 해당 scope와 scope 없는 이슈만 돌려준다. */
  issues(kind: EntryKind, scope?: string): Array<{ path: string; message: string }> {
    const rows = (
      scope === undefined
        ? this.db.prepare('SELECT path, message FROM issues WHERE kind = ?').all(kind)
        : this.db
            .prepare(
              "SELECT path, message FROM issues WHERE kind = ? AND (scope = ? OR scope = '')"
            )
            .all(kind, scope)
    ) as Array<{ path: string; message: string }>
    return rows
  }
}

function parseData(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    throw new CacheCorruptError('row JSON is invalid')
  }
}
