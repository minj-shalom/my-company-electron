import type { PublisherAdapter } from '../../shared/publisher'

/** 기본 어댑터. 아무것도 보관하지 않고 CEO가 직접 게시하는 현행 흐름(T-050)을 그대로 둔다. */
export const MANUAL_ADAPTER_ID = 'manual'

export function createManualAdapter(): PublisherAdapter {
  return {
    id: MANUAL_ADAPTER_ID,
    displayName: '직접 게시',
    scopes: [],
    usesCredentials: false,
    connect: async () => undefined,
    status: async () => ({ state: 'connected' }),
    disconnect: async () => ({ revoked: false }),
    // 자동 게시를 하지 않는다. 호출되면 사람이 직접 게시해야 한다는 뜻으로 거부한다.
    publish: async () => ({ ok: false, code: 'rejected' })
  }
}
