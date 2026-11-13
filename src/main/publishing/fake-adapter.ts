import type {
  AdapterContext,
  PublisherAdapter,
  PublisherPublishRequest,
  PublisherPublishResult
} from '../../shared/publisher'

/** 테스트 전용. 네트워크 없이 가짜 토큰을 보관소에 저장하고 호출을 기록한다. 프로덕션 레지스트리에 넣지 않는다. */
export const FAKE_ADAPTER_ID = 'fake'

export interface FakeAdapter extends PublisherAdapter {
  published: PublisherPublishRequest[]
  revokeCalls: string[]
  /** `disconnect`가 서버 측 폐기에 실패하도록 한다. */
  failRevoke: boolean
}

export function createFakeAdapter(token = 'dummy-token-not-real-0001'): FakeAdapter {
  const adapter: FakeAdapter = {
    id: FAKE_ADAPTER_ID,
    displayName: '가짜 어댑터',
    scopes: [{ id: 'post:write', description: '글 게시만 허용 (읽기·삭제 없음)' }],
    usesCredentials: true,
    published: [],
    revokeCalls: [],
    failRevoke: false,
    connect: async (ctx: AdapterContext) => {
      await ctx.vault.set('default', token, { displayName: '테스트 블로그', expiresAt: null })
    },
    status: async (ctx) => ({
      state: (await ctx.vault.get('default')) === null ? 'disconnected' : 'connected'
    }),
    disconnect: async (ctx) => {
      const t = await ctx.vault.get('default')
      if (t === null) return { revoked: false }
      adapter.revokeCalls.push(t)
      if (adapter.failRevoke) throw new Error(`revoke failed for ${t}`)
      return { revoked: true }
    },
    publish: async (req, ctx, opts): Promise<PublisherPublishResult> => {
      if ((await ctx.vault.get('default')) === null) return { ok: false, code: 'not-connected' }
      if (opts?.dryRun === true) return { ok: true, dryRun: true }
      adapter.published.push(req)
      return { ok: true, link: `https://example.com/posts/${req.contentHash.slice(0, 8)}` }
    }
  }
  return adapter
}
