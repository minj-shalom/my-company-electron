import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { ACCOUNT_ID, MAX_DISPLAY_NAME, type CredentialAccountStatus } from '../../shared/publisher'
import { secrets, type SecretRegistry } from './redact'

/**
 * 발행용 자격 증명 보관소(T-054, D-019). main 내부 API만 있고 IPC·preload 어디에도 연결하지 않는다.
 * 제공자 CLI(Claude/Codex/Gemini)의 로그인 정보는 다루지 않는다.
 *
 * - 값은 Electron `safeStorage`(OS 보안 저장소)로만 암호화한다. 암호화를 쓸 수 없으면 거부하고 평문으로 저장하지 않는다.
 * - 암호문은 userData 전용 파일에만 둔다 (회사 폴더·git 밖). 파일 0600, 폴더 0700.
 * - 키는 `어댑터id:계정id` 형식이고 어댑터 id는 허용 목록이어야 한다.
 */

/** `electron.safeStorage`의 필요한 부분. 테스트에서 가짜로 주입한다. */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(plain: string): Buffer
  decryptString(cipher: Buffer): string
}

export type VaultErrorCode =
  'encryption-unavailable' | 'invalid-key' | 'invalid-value' | 'storage-failed'

/** 메시지는 고정 문구다. 키·값·경로를 담지 않는다. */
export class VaultError extends Error {
  constructor(readonly code: VaultErrorCode) {
    super(code)
    this.name = 'VaultError'
  }
}

interface StoredEntry {
  /** base64 암호문. */
  cipher: string
  displayName: string
  expiresAt: string | null
}

interface StoreFile {
  version: 1
  entries: Record<string, StoredEntry>
}

export interface VaultDeps {
  /** userData 폴더. 이 아래 `credentials/vault.json`만 쓴다. */
  userDataDir: string
  safeStorage: SafeStorageLike
  /** 허용된 어댑터 id (자격 증명을 쓰는 어댑터). */
  allowedAdapterIds: readonly string[]
  registry?: SecretRegistry
}

const MIN_VALUE = 6
const MAX_VALUE = 8192
const MAX_ENTRIES = 50

export function makeKey(adapterId: string, accountId: string): string {
  return `${adapterId}:${accountId}`
}

function isStoreFile(v: unknown): v is StoreFile {
  if (typeof v !== 'object' || v === null) return false
  const o = v as { version?: unknown; entries?: unknown }
  if (o.version !== 1 || typeof o.entries !== 'object' || o.entries === null) return false
  return Object.values(o.entries).every((e) => {
    const x = e as Partial<StoredEntry> | null
    return (
      typeof x === 'object' &&
      x !== null &&
      typeof x.cipher === 'string' &&
      typeof x.displayName === 'string' &&
      (x.expiresAt === null || typeof x.expiresAt === 'string')
    )
  })
}

export class CredentialVault {
  private readonly file: string
  private readonly registry: SecretRegistry
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly deps: VaultDeps) {
    this.file = join(deps.userDataDir, 'credentials', 'vault.json')
    this.registry = deps.registry ?? secrets
  }

  encryptionAvailable(): boolean {
    try {
      return this.deps.safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  }

  private parseKey(key: string): { adapterId: string; accountId: string } {
    const i = key.indexOf(':')
    const adapterId = i < 0 ? '' : key.slice(0, i)
    const accountId = i < 0 ? '' : key.slice(i + 1)
    if (!this.deps.allowedAdapterIds.includes(adapterId) || !ACCOUNT_ID.test(accountId))
      throw new VaultError('invalid-key')
    return { adapterId, accountId }
  }

  /** 쓰기는 한 줄로 세워 읽기-수정-쓰기가 겹쳐 값을 잃지 않게 한다. */
  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task)
    this.queue = run.catch(() => undefined)
    return run
  }

  private async load(): Promise<StoreFile> {
    let raw: string
    try {
      raw = await readFile(this.file, 'utf8')
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, entries: {} }
      throw new VaultError('storage-failed')
    }
    try {
      const parsed: unknown = JSON.parse(raw)
      if (isStoreFile(parsed)) return parsed
    } catch {
      // 아래에서 같은 오류로 처리한다.
    }
    // 깨진 파일을 빈 것으로 덮으면 다른 값을 잃는다. 거부하고 사람이 처리하게 둔다.
    throw new VaultError('storage-failed')
  }

  private async save(store: StoreFile): Promise<void> {
    try {
      const dir = dirname(this.file)
      await mkdir(dir, { recursive: true, mode: 0o700 })
      await chmod(dir, 0o700)
      const tmp = `${this.file}.tmp`
      await writeFile(tmp, JSON.stringify(store), { mode: 0o600 })
      await chmod(tmp, 0o600)
      await rename(tmp, this.file)
    } catch {
      throw new VaultError('storage-failed')
    }
  }

  async set(
    key: string,
    value: string,
    meta: { displayName: string; expiresAt: string | null }
  ): Promise<void> {
    this.parseKey(key)
    if (
      typeof value !== 'string' ||
      value.length < MIN_VALUE ||
      value.length > MAX_VALUE ||
      value.includes('\0')
    )
      throw new VaultError('invalid-value')
    const name = meta.displayName.trim()
    if (
      name === '' ||
      name.length > MAX_DISPLAY_NAME ||
      [...name].some((c) => c.charCodeAt(0) < 0x20)
    )
      throw new VaultError('invalid-value')
    if (meta.expiresAt !== null && Number.isNaN(Date.parse(meta.expiresAt)))
      throw new VaultError('invalid-value')
    // 평문 폴백 없음: 암호화를 쓸 수 없으면 아무것도 쓰지 않는다.
    if (!this.encryptionAvailable()) throw new VaultError('encryption-unavailable')
    this.registry.register(value)
    let cipher: string
    try {
      cipher = this.deps.safeStorage.encryptString(value).toString('base64')
    } catch {
      throw new VaultError('encryption-unavailable')
    }
    return this.serial(async () => {
      const store = await this.load()
      if (!(key in store.entries) && Object.keys(store.entries).length >= MAX_ENTRIES)
        throw new VaultError('invalid-key')
      store.entries[key] = { cipher, displayName: name, expiresAt: meta.expiresAt }
      await this.save(store)
    })
  }

  /** main 내부 전용. 값을 호출자 메모리로만 돌려준다. */
  async get(key: string): Promise<string | null> {
    this.parseKey(key)
    if (!this.encryptionAvailable()) throw new VaultError('encryption-unavailable')
    const store = await this.load()
    const e = store.entries[key]
    if (e === undefined) return null
    try {
      const value = this.deps.safeStorage.decryptString(Buffer.from(e.cipher, 'base64'))
      this.registry.register(value)
      return value
    } catch {
      throw new VaultError('storage-failed')
    }
  }

  async delete(key: string): Promise<void> {
    this.parseKey(key)
    return this.serial(async () => {
      const store = await this.load()
      if (!(key in store.entries)) return
      delete store.entries[key]
      await this.save(store)
    })
  }

  /** 값 없이 메타데이터만. 어댑터 id가 허용 목록 밖이면 빈 목록. 파일이 깨졌으면 `storage-failed`. */
  async accounts(adapterId: string): Promise<CredentialAccountStatus[]> {
    if (!this.deps.allowedAdapterIds.includes(adapterId)) return []
    const store = await this.load()
    const prefix = `${adapterId}:`
    return Object.entries(store.entries)
      .filter(([k]) => k.startsWith(prefix))
      .map(([k, e]) => ({
        accountId: k.slice(prefix.length),
        displayName: e.displayName,
        expiresAt: e.expiresAt
      }))
  }
}
