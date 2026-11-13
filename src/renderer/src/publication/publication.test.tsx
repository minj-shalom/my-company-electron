import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { PublicationEntry } from '../../../shared/publication'
import { createMockPublicationApi } from '../mock-publication'
import { DraftPreview } from './DraftPreview'
import { PublicationItem } from './PublicationItem'
import { PublicationBody } from './PublicationSection'
import {
  checkLink,
  loadDrafts,
  markPublishedFlow,
  parseApprovalCard,
  progressText,
  publicationErrorText,
  publishFlow,
  readDraftText,
  type DraftsLoad
} from './publication-model'

const entry = (over: Partial<PublicationEntry> = {}): PublicationEntry => ({
  id: '0123456789ab',
  date: '2026-11-13',
  title: '<b>제목</b>',
  path: 'a.md',
  hash: 'a'.repeat(64),
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
const noop = async (): Promise<string | null> => null
const actions = { approve: noop, publish: noop, mark: noop }
const item = (e: PublicationEntry, locked = false): string =>
  renderToStaticMarkup(
    <PublicationItem entry={e} projectId="blog" locked={locked} actions={actions} />
  )
const ready = (items: PublicationEntry[], unreadable = 0): DraftsLoad => ({
  kind: 'ready',
  projectId: 'blog',
  list: { projectId: 'blog', items, unreadable },
  progress: { projectId: 'blog', date: '2026-11-13', goal: 3, approvedToday: 1, publishedToday: 0 }
})
const body = (load: DraftsLoad): string =>
  renderToStaticMarkup(
    <PublicationBody load={load} refreshing={false} projectId="blog" reload={() => {}} />
  )

describe('card parsing', () => {
  it('extracts project and paths, ignoring bad ones', () => {
    expect(
      parseApprovalCard(
        'blog 프로젝트의 초안 2건을 승인할까요? a.md@aaaaaaa, ../x.md@bbbbbbb, b/c.md@ccccccc'
      )
    ).toEqual({ projectId: 'blog', paths: ['a.md', 'b/c.md'] })
    expect(parseApprovalCard('초안을 발행할까요?')).toBeNull()
    expect(
      parseApprovalCard('blog 프로젝트의 초안 1건을 승인할까요? /etc/passwd@aaaaaaa')
    ).toBeNull()
  })
})

describe('link and messages', () => {
  it('accepts only https or empty', () => {
    expect(checkLink('')).toEqual({ ok: true, link: undefined })
    expect(checkLink(' https://a.example/x ')).toEqual({ ok: true, link: 'https://a.example/x' })
    for (const bad of ['http://a.example', 'javascript:alert(1)', 'https://a b', 'a.example'])
      expect(checkLink(bad).ok).toBe(false)
  })
  it('never exposes main messages', () => {
    expect(publicationErrorText('internal')).not.toContain('/')
    expect(publicationErrorText('weird')).toContain('처리하지 못했어요')
  })
  it('progress text', () => {
    expect(
      progressText({ projectId: 'p', date: 'd', goal: 3, approvedToday: 1, publishedToday: 0 })
    ).toContain('1 / 목표 3')
    expect(
      progressText({ projectId: 'p', date: 'd', goal: 0, approvedToday: 0, publishedToday: 0 })
    ).toContain('목표 없음')
  })
})

describe('flows with mock api', () => {
  it('loads, reads plain text, rejects bad paths', async () => {
    const { api } = createMockPublicationApi('ok')
    const l = await loadDrafts(api, 'blog')
    expect(l.kind === 'ready' && l.list.items.length).toBeGreaterThan(1)
    const t = await readDraftText(api, 'blog', 'post-3.md')
    expect(t.kind === 'ready' && t.text).toContain('<script>')
    expect((await readDraftText(api, 'blog', '../x.md')).kind).toBe('error')
  })
  it('error scenario gives easy text without paths', async () => {
    const l = await loadDrafts(createMockPublicationApi('error').api, 'blog')
    expect(l).toEqual({ kind: 'error', message: expect.not.stringContaining('/Users') })
  })
  it('publish flow: manual then mark; reapproval scenario', async () => {
    const { api } = createMockPublicationApi('ok')
    const l = await loadDrafts(api, 'blog')
    const approved =
      l.kind === 'ready' ? l.list.items.find((e) => e.status === 'approved')! : entry()
    const r = await publishFlow(api, 'blog', approved)
    expect(r).toMatchObject({ ok: true, outcome: 'manual-required' })
    expect((await markPublishedFlow(api, 'blog', approved.id, 'http://x')).ok).toBe(false)
    expect((await markPublishedFlow(api, 'blog', approved.id, 'https://x.example/p')).ok).toBe(true)
    const re = createMockPublicationApi('reapproval').api
    const l2 = await loadDrafts(re, 'blog')
    const a2 = l2.kind === 'ready' ? l2.list.items.find((e) => e.status === 'approved')! : entry()
    const r2 = await publishFlow(re, 'blog', a2)
    expect(r2).toMatchObject({ outcome: 'reapproval-required' })
    expect(r2.ok && r2.message).toContain('다시 승인')
  })
})

describe('rendering', () => {
  it('escapes title and shows plain link text, never an anchor', () => {
    const html = item(
      entry({ status: 'published', approvedBy: 'auto', link: 'https://e.example/x' })
    )
    expect(html).toContain('&lt;b&gt;제목&lt;/b&gt;')
    expect(html).toContain('자동 승인')
    expect(html).toContain('https://e.example/x')
    expect(html).not.toContain('<a ')
  })
  it('shows per-status actions and reapproval hint', () => {
    expect(item(entry())).toContain('승인 요청')
    expect(item(entry({ note: 'x' }))).toContain('다시 확인하고 승인을 요청')
    const a = item(entry({ status: 'approved', approvedBy: 'ceo' }))
    expect(a).toContain('발행 진행')
    expect(a).toContain('발행함으로 표시')
    expect(item(entry({ status: 'rejected', note: '고쳐 주세요' }))).toContain('고쳐 주세요')
  })
  it('draft preview is closed by default and never renders html', () => {
    const html = renderToStaticMarkup(<DraftPreview projectId="blog" path="a.md" />)
    expect(html).toContain('초안 보기')
    expect(html).toContain('hidden')
  })
  it('body states', () => {
    expect(body({ kind: 'loading' })).toContain('불러오고 있어요')
    expect(body({ kind: 'error', message: '실패했어요' })).toContain('role="alert"')
    expect(body(ready([]))).toContain('아직 초안이 없어요')
    const full = body(ready([entry()], 2))
    expect(full).toContain('읽지 못한 발행 기록이 2건')
    expect(full).toContain('오늘 승인 1 / 목표 3')
    expect(full).toContain('aria-disabled="true"')
  })
})
