import { createHash } from 'node:crypto'
import type { IntegrityActionResult } from '../../shared/integrity'
import type { StateStore } from '../gate/state-store'
import type { SafeFs } from '../repository/safe-fs'
import { hashOfPath, type Manifest, type ManifestChange } from './hr-manifest'

/** 결재함이 이 라벨의 선택지를 복원 호출로 연결한다. 카드 생성 쪽과 같은 값을 써야 한다. */
export const OUT_OF_SCOPE_RESTORE = '범위 밖 복원'
const MAX_RECORDS = 5
const MAX_FILES = 200
const DELETED = 'deleted'

/** 허용 목록 밖 변경 하나의 복원 정보. 변경 전 본문이 없으면(크기 상한, 이진 파일, 링크) 자동 복원할 수 없다. */
export interface ViolationFile {
  path: string
  kind: ManifestChange['kind']
  /** 변경 전 본문. 추가된 파일은 null(복원은 삭제), 복원할 수 없으면 `unrestorable`. */
  before: string | null | 'unrestorable'
  afterHash: string
}

export interface ViolationRecord {
  stateHash: string
  at: string
  files: ViolationFile[]
  /** 변경이 상한(200건)을 넘어 일부만 담았다. 이 경우 자동 복원하지 않는다. */
  truncated?: boolean
}

const sha = (v: string): string => createHash('sha256').update(v, 'utf8').digest('hex')

export function violationHash(files: readonly { path: string; afterHash: string }[]): string {
  return sha(
    files
      .map((f) => `${f.path}:${f.afterHash}`)
      .sort()
      .join('\n')
  )
}

export function buildViolation(
  changes: readonly ManifestChange[],
  before: Manifest,
  after: Manifest,
  at: Date
): ViolationRecord {
  const files: ViolationFile[] = changes.slice(0, MAX_FILES).map((c) => {
    const b = before.entries.get(c.path)
    const a = after.entries.get(c.path)
    let prior: ViolationFile['before']
    if (c.kind === 'added') prior = null
    else prior = b?.text ?? 'unrestorable'
    // 링크와 특수 파일은 SafeFs로 지우거나 덮어쓸 수 없고, 변경 후 상태가 이것이면 앱이 안전하게 되돌릴 수 없다.
    const h = a?.hash ?? ''
    if (h.startsWith('symlink:') || h === 'other') prior = 'unrestorable'
    return { path: c.path, kind: c.kind, before: prior, afterHash: a?.hash ?? DELETED }
  })
  return {
    stateHash: violationHash(files),
    at: at.toISOString(),
    files,
    ...(changes.length > MAX_FILES ? { truncated: true } : {})
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

function parse(raw: unknown): ViolationRecord[] {
  if (!isRecord(raw) || !Array.isArray(raw.records)) return []
  const out: ViolationRecord[] = []
  for (const r of raw.records) {
    if (!isRecord(r) || typeof r.stateHash !== 'string' || !Array.isArray(r.files)) continue
    const files: ViolationFile[] = []
    for (const f of r.files)
      if (
        isRecord(f) &&
        typeof f.path === 'string' &&
        typeof f.afterHash === 'string' &&
        (f.kind === 'added' || f.kind === 'removed' || f.kind === 'modified') &&
        (f.before === null || typeof f.before === 'string')
      )
        files.push({ path: f.path, kind: f.kind, before: f.before, afterHash: f.afterHash })
    out.push({
      stateHash: r.stateHash,
      at: typeof r.at === 'string' ? r.at : '',
      files,
      ...(r.truncated === true ? { truncated: true } : {})
    })
  }
  return out
}

/**
 * 범위 밖 변경의 복원 정보. userData에 두어 hr이 읽거나 고칠 수 없다. 복원은 CEO가 카드에서 누를 때만 한다.
 */
export class ViolationStore {
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly store: StateStore,
    private readonly fs: SafeFs,
    private readonly exclusive: <T>(t: () => Promise<T>) => Promise<T>
  ) {}

  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task)
    this.queue = run.catch(() => undefined)
    return run
  }

  save(rec: ViolationRecord): Promise<void> {
    return this.serial(async () => {
      const all = parse(await this.store.load()).filter((r) => r.stateHash !== rec.stateHash)
      all.push(rec)
      await this.store.save({ records: all.slice(-MAX_RECORDS) })
    })
  }

  /** 현재 상태가 카드를 만든 뒤 달라졌으면 `stale`, 되돌릴 수 없는 파일이 있으면 `not-restorable`. */
  restore(expectedHash: string): Promise<IntegrityActionResult> {
    return this.serial(async () => {
      const rec = parse(await this.store.load()).find((r) => r.stateHash === expectedHash)
      if (rec === undefined) return { ok: false, code: 'no-baseline', files: [] }
      const stuck = rec.files.filter((f) => f.before === 'unrestorable').map((f) => f.path)
      if (rec.truncated === true) return { ok: false, code: 'not-restorable', files: stuck }
      if (stuck.length > 0) return { ok: false, code: 'not-restorable', files: stuck }
      return this.exclusive(async () => {
        for (const f of rec.files) {
          const now = await this.currentHash(f.path)
          if (now !== f.afterHash) return { ok: false, code: 'stale', files: [] } as const
        }
        for (const f of rec.files) {
          if (f.before === null) await this.fs.remove(f.path).catch(() => undefined)
          else if (f.before !== 'unrestorable') await this.fs.writeText(f.path, f.before)
        }
        return { ok: true, restored: rec.files.length } as const
      })
    })
  }

  private currentHash(path: string): Promise<string> {
    return hashOfPath(this.fs.root, path)
  }
}
