import type { WindowApi } from '../../shared/api'
import { isPublishLink, type PublicationEntry } from '../../shared/publication'

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

export const PUBLICATION_SCENARIOS = [
  'ok',
  'empty',
  'error',
  'slow',
  'unreadable',
  'reapproval'
] as const
export type PublicationScenario = (typeof PUBLICATION_SCENARIOS)[number]

/** 브라우저 개발 전용. `?mock-publication=ok|empty|error|slow|unreadable|reapproval`. */
export function parsePublicationScenario(search: string): PublicationScenario {
  const v = new URLSearchParams(search).get('mock-publication')
  return PUBLICATION_SCENARIOS.find((s) => s === v) ?? 'ok'
}

// 본문은 신뢰할 수 없는 텍스트라는 점을 확인할 수 있게 태그가 든 글을 하나 둔다.
const HOSTILE =
  '# 위험해 보이는 초안\n\n<script>alert(1)</script>\n<b>태그는 글자 그대로 보여요</b>'

/** 개발 서버(브라우저)에서만 쓰는 최소 mock. 상태는 메모리에만 둔다. */
export function createMockPublicationApi(
  scenario: PublicationScenario = typeof location === 'undefined'
    ? 'ok'
    : parsePublicationScenario(location.search)
): { api: Mock; reset: () => void } {
  let items: PublicationEntry[] = []
  const wait = (): Promise<void> =>
    scenario === 'slow' ? new Promise((r) => setTimeout(r, 2500)) : Promise.resolve()
  const reset = (): void => {
    if (scenario === 'empty' || scenario === 'error') {
      items = []
      return
    }
    items = [
      base({}),
      base({
        id: '0123456789ad',
        title: '위험해 보이는 초안',
        path: 'post-3.md',
        note: scenario === 'reapproval' ? '내용이 바뀌었어요' : null
      }),
      base({
        id: '0123456789ae',
        title: '거절된 글',
        path: 'post-4.md',
        status: 'rejected',
        note: '제목을 더 구체적으로 바꿔 주세요.'
      }),
      base({
        id: '0123456789af',
        title: '발행한 글',
        path: 'post-0.md',
        status: 'published',
        approvedAt: '2026-11-12T01:00:00.000Z',
        approvedBy: 'auto',
        link: 'https://example.com/blog/post-0'
      }),
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
  const snapshot = async (projectId: string): ReturnType<Mock['listPublications']> => {
    await wait()
    if (scenario === 'error')
      return { ok: false, code: 'internal', message: '/Users/x/company/publishing/blog.md EACCES' }
    return {
      ok: true,
      value: { projectId, items: [...items], unreadable: scenario === 'unreadable' ? 2 : 0 }
    }
  }
  const api: Mock = {
    listPublications: ({ projectId }) => snapshot(projectId),
    scanPublications: ({ projectId }) => snapshot(projectId),
    readPublicationDraft: async ({ path }) => {
      const text = path === 'post-3.md' ? HOSTILE : '# 초안\n\n본문 내용입니다.\n\n둘째 문단이에요.'
      return { ok: true, value: { path, hash: HASH, size: text.length, text } }
    },
    requestPublicationApproval: async () => ({
      ok: true,
      value: { cardIds: ['D-901'], autoPending: 0, skipped: 0 }
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
      if (!e) return nf
      if (scenario === 'reapproval') {
        e.status = 'draft'
        e.note = '내용이 바뀌었어요'
        return { ok: true, value: { status: 'reapproval-required', entry: { ...e } } }
      }
      return { ok: true, value: { status: 'manual-required', entry: { ...e } } }
    },
    markPublished: async ({ id, link }) => {
      const e = find(id)
      if (!e) return nf
      if (link !== undefined && !isPublishLink(link))
        return { ok: false, code: 'invalid-request', message: '링크 형식이 올바르지 않습니다.' }
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
