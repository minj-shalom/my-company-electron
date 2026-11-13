import type {
  AdapterContext,
  AdapterVault,
  CredentialAdapterStatus,
  CredentialDisconnectResult,
  CredentialState
} from '../../shared/publisher'
import { ADAPTER_ID } from '../../shared/publisher'
import type { AdapterRegistry } from '../publishing/adapter-registry'
import { makeKey, type CredentialVault } from './credential-vault'

/** 만료까지 이 기간 이하면 `expiring`. */
const EXPIRING_MS = 7 * 24 * 60 * 60 * 1000

export class CredentialServiceError extends Error {
  constructor(readonly code: 'unknown-adapter' | 'failed') {
    super(code)
    this.name = 'CredentialServiceError'
  }
}

export interface CredentialServiceDeps {
  vault: CredentialVault
  registry: AdapterRegistry
  openExternal: (url: string) => Promise<void>
  now?: () => Date
}

/** 한 어댑터의 키만 다루는 보관소 창구. 다른 어댑터의 값은 읽을 수 없다. */
function scopedVault(vault: CredentialVault, adapterId: string, onSet: () => void): AdapterVault {
  return {
    get: (accountId) => vault.get(makeKey(adapterId, accountId)),
    set: async (accountId, value, meta) => {
      await vault.set(makeKey(adapterId, accountId), value, meta)
      onSet()
    },
    delete: (accountId) => vault.delete(makeKey(adapterId, accountId)),
    accounts: () => vault.accounts(adapterId)
  }
}

/**
 * 상태 조회와 연결 해제. renderer가 받는 모든 값은 상태·만료·표시명이다 (값 반환 경로 없음).
 * 어댑터가 던진 오류는 내용을 버리고 닫힌 코드로만 바꾼다 (오류 문자열에 토큰이 섞일 수 있다).
 */
export class CredentialService {
  private readonly now: () => Date
  /** 토큰 갱신 실패로 낮춘 상태 (메모리). 재연결(`vault.set`)이나 해제가 지운다. */
  private readonly degraded = new Map<string, 'expiring' | 'error'>()

  constructor(private readonly deps: CredentialServiceDeps) {
    this.now = deps.now ?? (() => new Date())
  }

  contextFor(adapterId: string, signal?: AbortSignal): AdapterContext {
    return {
      adapterId,
      vault: scopedVault(this.deps.vault, adapterId, () => this.degraded.delete(adapterId)),
      openExternal: this.deps.openExternal,
      markDegraded: (state) => {
        // `error`가 `expiring`보다 우선한다.
        if (this.degraded.get(adapterId) !== 'error') this.degraded.set(adapterId, state)
      },
      signal
    }
  }

  async status(): Promise<CredentialAdapterStatus[]> {
    const out: CredentialAdapterStatus[] = []
    for (const a of this.deps.registry.list())
      if (a.usesCredentials) out.push(await this.statusOf(a.id))
    return out
  }

  async statusOf(adapterId: string): Promise<CredentialAdapterStatus> {
    const a = this.deps.registry.get(adapterId)
    if (a === undefined || !a.usesCredentials || !ADAPTER_ID.test(adapterId))
      throw new CredentialServiceError('unknown-adapter')
    const encryptionAvailable = this.deps.vault.encryptionAvailable()
    let state: CredentialState = 'disconnected'
    let accounts: CredentialAdapterStatus['accounts'] = []
    try {
      accounts = await this.deps.vault.accounts(adapterId)
      if (accounts.length > 0) {
        const t = this.now().getTime()
        const soon = accounts.some(
          (x) => x.expiresAt !== null && Date.parse(x.expiresAt) - t <= EXPIRING_MS
        )
        state = soon ? 'expiring' : 'connected'
        const d = this.degraded.get(adapterId)
        if (d === 'error' || (d === 'expiring' && state === 'connected')) state = d
        if (encryptionAvailable) {
          // 어댑터가 서버 측 폐기 등을 알면 `error`로 낮출 수 있다.
          const s = await a
            .status(this.contextFor(adapterId))
            .catch(() => ({ state: 'error' as const }))
          if (s.state === 'error') state = 'error'
        }
      }
    } catch {
      state = 'error'
    }
    return {
      adapterId,
      displayName: a.displayName,
      scopes: a.scopes.map((s) => ({ ...s })),
      state,
      accounts,
      encryptionAvailable
    }
  }

  /** 서버 측 폐기를 시도하고, 성공 여부와 무관하게 로컬 값을 모두 삭제한다. */
  async disconnect(adapterId: string): Promise<CredentialDisconnectResult> {
    const a = this.deps.registry.get(adapterId)
    if (a === undefined || !a.usesCredentials) throw new CredentialServiceError('unknown-adapter')
    let revoked: boolean
    try {
      revoked = (await a.disconnect(this.contextFor(adapterId))).revoked
    } catch {
      revoked = false
    }
    this.degraded.delete(adapterId)
    try {
      for (const acc of await this.deps.vault.accounts(adapterId))
        await this.deps.vault.delete(makeKey(adapterId, acc.accountId))
    } catch {
      throw new CredentialServiceError('failed')
    }
    return { status: await this.statusOf(adapterId), revoked }
  }
}
