import Database from 'better-sqlite3'

/** 빈 인메모리 DB를 열어 네이티브 모듈(Electron ABI) 로드를 확인한다. 실제 캐시 스키마는 별도 티켓. */
export function checkSqlite(): string {
  const db = new Database(':memory:')
  try {
    const row = db.prepare('select sqlite_version() as v').get() as { v: string }
    return row.v
  } finally {
    db.close()
  }
}
