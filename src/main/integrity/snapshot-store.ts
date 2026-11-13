import { randomBytes } from 'node:crypto'
import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isProtectedPath, type FileMap } from './protected-files'

export const MAX_SNAPSHOTS = 20
export const SNAPSHOT_MAX_AGE_MS = 14 * 24 * 3600 * 1000

export type SnapshotKind = 'baseline' | 'pre-restore'

export interface Snapshot {
  id: string
  at: string
  kind: SnapshotKind
  /** 읽을 수 없던 파일(크기 상한 등)은 null. 하나라도 있으면 복원할 수 없다. */
  files: Record<string, string | null>
  hashes: Record<string, string>
}

export type SaveResult =
  { ok: true; snapshot: Snapshot } | { ok: false; reason: 'secret'; files: string[] }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

/** 디스크에서 읽은 값은 신뢰하지 않는다. 보호 대상 경로 밖 키가 있으면 스냅샷 전체를 버린다. */
function parseSnapshot(id: string, raw: unknown): Snapshot | null {
  if (!isRecord(raw) || !isRecord(raw.files) || !isRecord(raw.hashes)) return null
  if (typeof raw.at !== 'string' || Number.isNaN(Date.parse(raw.at))) return null
  if (raw.kind !== 'baseline' && raw.kind !== 'pre-restore') return null
  const files: Record<string, string | null> = {}
  const hashes: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw.files)) {
    if (!isProtectedPath(k) || (typeof v !== 'string' && v !== null)) return null
    files[k] = v
    const h = raw.hashes[k]
    if (typeof h !== 'string') return null
    hashes[k] = h
  }
  return { id, at: raw.at, kind: raw.kind, files, hashes }
}

/**
 * 스냅샷 저장소. 앱 userData 아래(회사 폴더 밖)에 두어 에이전트가 읽거나 쓸 수 없다.
 * 비밀 패턴이 있으면 저장하지 않고 중단한다 (호출자가 경고한다).
 */
export class SnapshotStore {
  private seq = 0
  constructor(
    private readonly dir: string,
    private readonly now: () => Date = () => new Date(),
    private readonly findSecrets: (files: FileMap) => string[] = () => []
  ) {}

  async save(files: FileMap, kind: SnapshotKind): Promise<SaveResult> {
    const secrets = this.findSecrets(files)
    if (secrets.length > 0) return { ok: false, reason: 'secret', files: secrets }
    const at = this.now()
    const id = `${String(at.getTime()).padStart(14, '0')}-${String(this.seq++ % 1000).padStart(3, '0')}-${randomBytes(3).toString('hex')}`
    const snap: Snapshot = { id, at: at.toISOString(), kind, files: {}, hashes: {} }
    for (const [k, v] of files) {
      snap.files[k] = v.text
      snap.hashes[k] = v.hash
    }
    await mkdir(this.dir, { recursive: true })
    const file = join(this.dir, `${id}.json`)
    const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`
    try {
      await writeFile(tmp, JSON.stringify(snap), { encoding: 'utf8', mode: 0o600 })
      await rename(tmp, file)
    } catch (e) {
      await unlink(tmp).catch(() => undefined)
      throw e
    }
    await this.prune()
    return { ok: true, snapshot: snap }
  }

  private async ids(): Promise<string[]> {
    try {
      return (await readdir(this.dir)).filter((f) => /^[0-9a-f-]+\.json$/.test(f)).sort()
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw e
    }
  }

  async load(id: string): Promise<Snapshot | null> {
    if (!/^[0-9a-f-]+$/.test(id)) return null
    try {
      return parseSnapshot(id, JSON.parse(await readFile(join(this.dir, `${id}.json`), 'utf8')))
    } catch {
      return null
    }
  }

  /** 가장 최근 `baseline` 스냅샷 (마지막 정상 상태). 없거나 읽을 수 없으면 null. */
  async latestBaseline(): Promise<Snapshot | null> {
    const ids = (await this.ids()).map((f) => f.slice(0, -5)).reverse()
    for (const id of ids) {
      const s = await this.load(id)
      if (s !== null && s.kind === 'baseline') return s
    }
    return null
  }

  async count(): Promise<number> {
    return (await this.ids()).length
  }

  /** 최근 20개와 14일만 남긴다. 가장 최근 baseline은 나이와 상관없이 지킨다. */
  async prune(): Promise<void> {
    const ids = (await this.ids()).map((f) => f.slice(0, -5))
    const keepNewest = new Set(ids.slice(-MAX_SNAPSHOTS))
    const cutoff = this.now().getTime() - SNAPSHOT_MAX_AGE_MS
    const protectedId = (await this.latestBaseline())?.id
    for (const id of ids) {
      const time = Number(id.slice(0, 14))
      if (id === protectedId) continue
      if (!keepNewest.has(id) || time < cutoff)
        await unlink(join(this.dir, `${id}.json`)).catch(() => undefined)
    }
  }
}
