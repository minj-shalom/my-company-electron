import type Database from 'better-sqlite3'

/**
 * 스키마 마이그레이션. 인덱스 i의 항목이 버전 i+1로 올리는 SQL이다 (`PRAGMA user_version`에 기록).
 * 캐시는 폴더에서 재생성되므로 파괴적 변경이 필요하면 항목을 추가하는 대신 `reset`으로 갈아엎어도 된다.
 * 이미 배포된 항목은 수정하지 말고 새 항목을 뒤에 추가한다.
 */
/** id는 유일하지 않다 (같은 id의 파일이 두 폴더에 있어도 원본 Repository처럼 첫 항목을 쓴다). 순서는 sort_key. */
export const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE entries (
    kind     TEXT    NOT NULL,
    id       TEXT    NOT NULL,
    status   TEXT    NOT NULL DEFAULT '',
    sort_key INTEGER NOT NULL,
    title    TEXT    NOT NULL DEFAULT '',
    data     TEXT    NOT NULL,
    PRIMARY KEY (kind, sort_key)
  );
  CREATE INDEX entries_kind_id ON entries (kind, id);
  CREATE INDEX entries_kind_status ON entries (kind, status, sort_key);
  CREATE TABLE issues (
    kind    TEXT NOT NULL,
    scope   TEXT NOT NULL DEFAULT '',
    path    TEXT NOT NULL,
    message TEXT NOT NULL
  );
  CREATE INDEX issues_kind ON issues (kind, scope);
  CREATE TABLE meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `
]

export type MigrationResult = 'ok' | 'too-new'

/** 현재 버전부터 끝까지 순서대로 적용한다. DB가 앱보다 새 버전이면 `too-new` (호출자가 reset). */
export function migrate(db: Database.Database, migrations: readonly string[]): MigrationResult {
  const current = db.pragma('user_version', { simple: true }) as number
  if (current > migrations.length) return 'too-new'
  for (let v = current; v < migrations.length; v++) {
    // user_version은 pragma라 바인딩이 안 된다. v는 우리가 만든 정수라 안전하다.
    db.transaction(() => {
      db.exec(migrations[v])
      db.pragma(`user_version = ${v + 1}`)
    })()
  }
  return 'ok'
}
