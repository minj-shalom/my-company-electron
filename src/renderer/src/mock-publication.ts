import type { WindowApi } from '../../shared/api'
import type { PublicationEntry } from '../../shared/publication'

type Mock = Pick<
  WindowApi,
  | 'listPublications'
  | 'scanPublications'
  | 'readPublicationDraft'
  | 'requestPublicationApproval'
  | 'requestPublish'
  | 'publishPublication'
  | 'markPublished'
  | 'getPublicationProgress'
>

const HASH = 'a'.repeat(64)
const base = (over: Partial<PublicationEntry>): PublicationEntry => ({
  id: '0123456789ab',
  date: '2026-11-13',
  title: '첫 번째 글',
  path: 'post-1.md',
  hash: HASH,
  status: 'draft',
  approvedAt: null,
  approvedBy: null,
  requestedAt: null,
  publishedAt: null,
  link: null,
  ticketId: null,
  cardId: null,
  note: null,
  ...over
})

/** 개발 서버(브라우저)에서만 쓰는 최소 mock. 상태는 메모리에만 둔다. */
export function createMockPublicationApi(): { api: Mock; reset: () => void } {
  let items: PublicationEntry[] = []
  const reset = (): void => {
    items = [
      base({}),
      base({
        id: '0123456789ac',
        title: '두 번째 글',
        path: 'post-2.md',
        status: 'approved',
        approvedAt: '2026-11-13T01:00:00.000Z',
        approvedBy: 'ceo'
      })
    ]
  }
  reset()
  const find = (id: string): PublicationEntry | undefined => items.find((e) => e.id === id)
  const nf = { ok: false, code: 'not-found', message: '발행 항목을 찾을 수 없습니다.' } as const
  const api: Mock = {
    listPublications: async ({ projectId }) => ({
      ok: true,
      value: { projectId, items: [...items], unreadable: 0 }
    }),
    scanPublications: async ({ projectId }) => ({
      ok: true,
      value: { projectId, items: [...items], unreadable: 0 }
    }),
    readPublicationDraft: async ({ path }) => ({
      ok: true,
      value: { path, hash: HASH, size: 24, text: '# 초안\n\n본문 내용입니다.' }
    }),
    requestPublicationApproval: async () => ({
      ok: true,
      value: { cardIds: [], autoPending: 0, skipped: 0 }
    }),
    requestPublish: async ({ id }) => {
      const e = find(id)
      if (!e) return nf
      if (e.status !== 'approved')
        return { ok: false, code: 'conflict', message: '승인된 초안만 발행을 요청할 수 있습니다.' }
      e.status = 'publish-requested'
      return { ok: true, value: { ...e } }
    },
    publishPublication: async ({ id }) => {
      const e = find(id)
      return e ? { ok: true, value: { status: 'manual-required', entry: { ...e } } } : nf
    },
    markPublished: async ({ id, link }) => {
      const e = find(id)
      if (!e) return nf
      if (e.status !== 'approved' && e.status !== 'publish-requested')
        return {
          ok: false,
          code: 'conflict',
          message: '승인된 초안만 발행함으로 표시할 수 있습니다.'
        }
      Object.assign(e, { status: 'published', link: link ?? null })
      return { ok: true, value: { status: 'published', entry: { ...e } } }
    },
    getPublicationProgress: async ({ projectId }) => ({
      ok: true,
      value: { projectId, date: '2026-11-13', goal: 3, approvedToday: 1, publishedToday: 0 }
    })
  }
  return { api, reset }
}
