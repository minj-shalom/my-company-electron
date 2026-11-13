import { PUBLISHER_ADAPTER_IDS, type PublisherAdapter } from '../../shared/publisher'

/**
 * 발행 어댑터 레지스트리. id는 허용 목록(`PUBLISHER_ADAPTER_IDS`)에 있어야 등록되고, 정책의 `발행 어댑터`는 이 id만 참조한다.
 * 테스트에서만 `allowedIds`에 가짜 어댑터 id를 더해 쓴다.
 */
export class AdapterRegistry {
  private readonly map = new Map<string, PublisherAdapter>()

  constructor(
    adapters: readonly PublisherAdapter[],
    private readonly allowedIds: readonly string[] = PUBLISHER_ADAPTER_IDS
  ) {
    for (const a of adapters) {
      if (!this.allowedIds.includes(a.id)) throw new Error('adapter-not-allowed')
      if (this.map.has(a.id)) throw new Error('adapter-duplicate')
      this.map.set(a.id, a)
    }
  }

  get(id: string): PublisherAdapter | undefined {
    return this.map.get(id)
  }

  list(): PublisherAdapter[] {
    return [...this.map.values()]
  }

  isAllowedId(id: string): boolean {
    return this.allowedIds.includes(id)
  }

  /** 자격 증명을 보관하는 어댑터 id. 보관소 키 허용 목록이 된다. */
  credentialAdapterIds(): string[] {
    return this.list()
      .filter((a) => a.usesCredentials)
      .map((a) => a.id)
  }
}
