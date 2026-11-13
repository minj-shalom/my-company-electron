import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ApprovalMode, PolicyState } from '../../shared/policy'
import { isPublishLink, type PublicationEntry } from '../../shared/publication'
import { makeCompany } from '../employee/test-company'
import { createFileGateCards } from '../gate/gate-cards'
import { createFakePublisher, type Publisher } from '../gate/publisher'
import { OutputPathError, listDrafts, readDraft } from './output-reader'
import { parsePublishing, publishingFile, serializePublishing } from './publication-doc'
import { PublicationService } from './publication-service'

const dirs: string[] = []
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
})

const NOW = new Date('2026-11-13T12:00:00Z')
const policyOf = (
  mode: ApprovalMode,
  over: { adapter?: string; goal?: number; auto?: boolean } = {}
): PolicyState =>
  ({
    values: {
      outputDir: 'drafts/',
      publishAdapter: over.adapter ?? 'manual',
      dailyOutputGoal: over.goal ?? 3
    },
    effective: { modes: { 'draft-approve': mode, publish: mode, push: 'every', merge: 'every' } },
    activation: over.auto ? { at: 'x', by: 'ceo-ui' } : null
  }) as unknown as PolicyState

// 반환 타입이 길어 추론에 맡긴다 (테스트 도구).
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
async function setup(
  o: {
    mode?: ApprovalMode
    adapter?: string
    publishers?: Map<string, Publisher>
    auto?: boolean
  } = {}
) {
  const c = await makeCompany()
  const proj = await mkdtemp(join(tmpdir(), 'mc-pub-'))
  dirs.push(c.dir, proj)
  await mkdir(join(proj, 'drafts'), { recursive: true })
  const clock = { now: NOW }
  const exclusive = <T>(t: () => Promise<T>): Promise<T> => c.repo.runExclusive(t)
  const svc = new PublicationService({
    fs: c.fs,
    exclusive,
    project: async (id) => (id === 'blog' ? { dir: proj, archived: false } : null),
    policy: async () => policyOf(o.mode ?? 'every', { adapter: o.adapter, auto: o.auto }),
    cards: createFileGateCards({ fs: c.fs, exclusive, now: () => NOW }),
    publishers: o.publishers,
    clock: { now: () => clock.now }
  })
  const draft = (name: string, text: string): Promise<void> =>
    writeFile(join(proj, 'drafts', name), text)
  const scan = async (): Promise<PublicationEntry[]> => {
    const r = await svc.scan({ projectId: 'blog' })
    if (!r.ok) throw new Error(r.message)
    return r.value.items
  }
  const record = (): Promise<string> => readFile(join(c.dir, publishingFile('blog')), 'utf8')
  return { c, proj, svc, draft, scan, record, clock }
}

const approve = async (t: Awaited<ReturnType<typeof setup>>, id: string): Promise<void> => {
  const r = await t.svc.requestApproval({ projectId: 'blog', ids: [id] })
  if (!r.ok) throw new Error(r.message)
  await t.svc.onCardResolved(r.value.cardIds[0], 'A', null)
}

describe('output reader (read-only, path guards)', () => {
  it('rejects traversal, absolute paths, bad names, and symlinks; enforces 1MB', async () => {
    const t = await setup()
    await t.draft('a.md', '# A')
    expect((await readDraft(t.proj, 'drafts', 'a.md')).text).toBe('# A')
    for (const bad of ['../x.md', '/etc/passwd.md', 'a/../a.md', 'a.txt', '.hidden.md', 'a\\b.md'])
      await expect(readDraft(t.proj, 'drafts', bad)).rejects.toBeInstanceOf(OutputPathError)
    await expect(readDraft(t.proj, '../x', 'a.md')).rejects.toBeInstanceOf(OutputPathError)
    await expect(readDraft(t.proj, '/tmp', 'a.md')).rejects.toBeInstanceOf(OutputPathError)

    const outside = await mkdtemp(join(tmpdir(), 'mc-out-'))
    dirs.push(outside)
    await writeFile(join(outside, 'secret.md'), 'secret')
    await symlink(join(outside, 'secret.md'), join(t.proj, 'drafts', 'link.md'))
    await symlink(outside, join(t.proj, 'drafts', 'dirlink'))
    await expect(readDraft(t.proj, 'drafts', 'link.md')).rejects.toBeInstanceOf(OutputPathError)
    await expect(readDraft(t.proj, 'drafts', 'dirlink/secret.md')).rejects.toBeInstanceOf(
      OutputPathError
    )
    expect(await listDrafts(t.proj, 'drafts')).toEqual(['a.md'])
    // 산출물 폴더 자체가 링크면 거부한다.
    await symlink(outside, join(t.proj, 'out-link'))
    await expect(readDraft(t.proj, 'out-link', 'secret.md')).rejects.toBeInstanceOf(OutputPathError)

    await writeFile(join(t.proj, 'drafts', 'big.md'), 'x'.repeat(1024 * 1024 + 1))
    await expect(readDraft(t.proj, 'drafts', 'big.md')).rejects.toThrow('too-large')
  })

  it('service maps errors to fixed messages without paths', async () => {
    const t = await setup()
    const r = await t.svc.readDraftContent({ projectId: 'blog', path: 'nope.md' })
    expect(r).toMatchObject({ ok: false, code: 'not-found' })
    expect(JSON.stringify(r)).not.toContain(t.proj)
    expect(await t.svc.readDraftContent({ projectId: 'blog', path: '../a.md' })).toMatchObject({
      ok: false,
      code: 'invalid-request'
    })
    expect(await t.svc.readDraftContent({ projectId: 'blog', path: 'a.md', x: 1 })).toMatchObject({
      ok: false
    })
  })
})

describe('publishing record', () => {
  it('scan registers drafts once per date and path', async () => {
    const t = await setup()
    await t.draft('a.md', '# 제목 A\n본문')
    const first = await t.scan()
    expect(first).toHaveLength(1)
    expect(first[0]).toMatchObject({
      title: '제목 A',
      status: 'draft',
      date: '2026-11-13',
      path: 'a.md'
    })
    expect(await t.scan()).toHaveLength(1)
    expect((await t.record()).match(/^## 2026-11-13 a\.md$/gm)).toHaveLength(1)
  })

  it('refuses a duplicate block and refuses writes while unreadable content exists, preserving it', async () => {
    const t = await setup()
    await t.draft('a.md', '# A')
    await t.scan()
    const text = await t.record()
    const dup = `${text}\n${text.slice(text.indexOf('## 2026'))}\n## 메모\n손으로 쓴 글\n`
    await writeFile(join(t.c.dir, publishingFile('blog')), dup)
    const doc = parsePublishing(dup)
    expect(doc.entries).toHaveLength(1)
    expect(doc.unreadable).toBe(1)
    expect(serializePublishing(doc.preface, doc.entries, doc.layout)).toContain('손으로 쓴 글')
    await t.draft('b.md', '# B')
    expect(await t.svc.scan({ projectId: 'blog' })).toMatchObject({ ok: false, code: 'conflict' })
    expect(await readFile(join(t.c.dir, publishingFile('blog')), 'utf8')).toBe(dup)
  })

  it('treats hand-written published/approved blocks without approval as unreadable', () => {
    const h = 'a'.repeat(64)
    const block = (status: string): string =>
      `# x\n\n## 2026-11-13 a.md\n- 제목: t\n- 상태: ${status}\n- 해시: ${h}\n`
    expect(parsePublishing(block('draft')).entries).toHaveLength(1)
    for (const s of ['published', 'approved', 'publish-requested']) {
      const d = parsePublishing(block(s))
      expect(d.entries).toHaveLength(0)
      expect(d.unreadable).toBe(1)
    }
  })

  it('writes atomically without leftover temp files', async () => {
    const t = await setup()
    await t.draft('a.md', '# A')
    await t.scan()
    expect(
      (await readdir(join(t.c.dir, 'company/publishing'))).every((f) => !f.endsWith('.tmp'))
    ).toBe(true)
  })
})

describe('approval flow', () => {
  it('every mode makes one card per draft; approve sets approved/ceo, reject keeps reason', async () => {
    const t = await setup({ mode: 'every' })
    await t.draft('a.md', '# A')
    await t.draft('b.md', '# B')
    const [a, b] = await t.scan()
    const r = await t.svc.requestApproval({ projectId: 'blog' })
    expect(r.ok && r.value.cardIds).toHaveLength(2)
    const pending = await readdir(join(t.c.dir, 'company/decisions/pending'))
    const card = pending.find((f) => f.includes('content-approval'))
    expect(card).toBeDefined()
    const body = await readFile(join(t.c.dir, 'company/decisions/pending', card as string), 'utf8')
    expect(body).toContain('content-approval')
    expect(body).not.toContain('# A')
    // 대기 카드가 있으면 중복 요청하지 않는다.
    const again = await t.svc.requestApproval({ projectId: 'blog' })
    expect(again.ok && again.value.cardIds).toHaveLength(0)

    const list = await t.svc.list({ projectId: 'blog' })
    const ea = list.ok ? list.value.items.find((e) => e.id === a.id) : undefined
    const eb = list.ok ? list.value.items.find((e) => e.id === b.id) : undefined
    await t.svc.onCardResolved(ea?.cardId as string, 'A', null)
    await t.svc.onCardResolved(eb?.cardId as string, 'B', '톤을 \n고치세요')
    const after = (await t.svc.list({ projectId: 'blog' })) as {
      ok: true
      value: { items: PublicationEntry[] }
    }
    const pa = after.value.items.find((e) => e.id === a.id)
    const pb = after.value.items.find((e) => e.id === b.id)
    expect(pa).toMatchObject({ status: 'approved', approvedBy: 'ceo' })
    expect(pa?.approvedAt).toBe(NOW.toISOString())
    expect(pb).toMatchObject({ status: 'rejected', note: '톤을 고치세요' })
  })

  it('batch mode makes a single card for all drafts and approves them together', async () => {
    const t = await setup({ mode: 'batch' })
    await t.draft('a.md', '# A')
    await t.draft('b.md', '# B')
    await t.scan()
    const r = await t.svc.requestApproval({ projectId: 'blog' })
    expect(r.ok && r.value.cardIds).toHaveLength(1)
    if (r.ok) await t.svc.onCardResolved(r.value.cardIds[0], 'A', null)
    const items = await t.scan()
    expect(items.map((e) => e.status)).toEqual(['approved', 'approved'])
  })

  it('auto mode makes no card; only recordAutoApproval (active auto policy) approves as auto', async () => {
    const t = await setup({ mode: 'auto', auto: true })
    await t.draft('a.md', '# A')
    const [a] = await t.scan()
    const r = await t.svc.requestApproval({ projectId: 'blog' })
    expect(r.ok && r.value).toMatchObject({ cardIds: [], autoPending: 1 })
    const done = await t.svc.recordAutoApproval('blog', a.id)
    expect(done.ok && done.value).toMatchObject({ status: 'approved', approvedBy: 'auto' })

    const t2 = await setup({ mode: 'every' })
    await t2.draft('a.md', '# A')
    const [a2] = await t2.scan()
    expect(await t2.svc.recordAutoApproval('blog', a2.id)).toMatchObject({
      ok: false,
      code: 'forbidden'
    })
  })

  it('does not approve when the draft changed before the card was resolved', async () => {
    const t = await setup()
    await t.draft('a.md', '# A')
    const [a] = await t.scan()
    const r = await t.svc.requestApproval({ projectId: 'blog', ids: [a.id] })
    await t.draft('a.md', '# A changed')
    if (r.ok) await t.svc.onCardResolved(r.value.cardIds[0], 'A', null)
    const [after] = await t.scan()
    expect(after.status).toBe('draft')
    expect(after.approvedAt).toBeNull()
  })
})

describe('publishing', () => {
  it('cannot be published without approval (mark-published and publish)', async () => {
    const t = await setup()
    await t.draft('a.md', '# A')
    const [a] = await t.scan()
    expect(await t.svc.markPublished({ projectId: 'blog', id: a.id })).toMatchObject({
      ok: false,
      code: 'conflict'
    })
    expect(await t.svc.publish({ projectId: 'blog', id: a.id })).toMatchObject({
      ok: false,
      code: 'conflict'
    })
    expect(await t.svc.requestPublish({ projectId: 'blog', id: a.id })).toMatchObject({ ok: false })
    expect((await t.scan())[0].status).toBe('draft')
  })

  it('manual flow: approved -> publish-requested -> manual-required -> mark-published with https link', async () => {
    const t = await setup()
    await t.draft('a.md', '# A')
    const [a] = await t.scan()
    await approve(t, a.id)
    const req = await t.svc.requestPublish({ projectId: 'blog', id: a.id })
    expect(req.ok && req.value.status).toBe('publish-requested')
    const pub = await t.svc.publish({ projectId: 'blog', id: a.id })
    expect(pub.ok && pub.value.status).toBe('manual-required')
    for (const link of [
      'http://x.com/a',
      'javascript:alert(1)',
      'https://u:p@x.com',
      'https://x .com',
      'file:///etc/passwd'
    ])
      expect(await t.svc.markPublished({ projectId: 'blog', id: a.id, link })).toMatchObject({
        ok: false,
        code: 'invalid-request'
      })
    const done = await t.svc.markPublished({
      projectId: 'blog',
      id: a.id,
      link: 'https://blog.example/p/1'
    })
    expect(done.ok && done.value.entry).toMatchObject({
      status: 'published',
      link: 'https://blog.example/p/1',
      publishedAt: NOW.toISOString()
    })
    expect(await t.svc.markPublished({ projectId: 'blog', id: a.id })).toMatchObject({ ok: false })
    const p = await t.svc.progress({ projectId: 'blog' })
    expect(p.ok && p.value).toEqual({
      projectId: 'blog',
      date: '2026-11-13',
      goal: 3,
      approvedToday: 1,
      publishedToday: 1
    })
  })

  it('hash mismatch after approval blocks publishing, reverts to draft, and requires re-approval', async () => {
    const t = await setup()
    await t.draft('a.md', '# A')
    const [a] = await t.scan()
    await approve(t, a.id)
    await t.draft('a.md', '# A swapped')
    const r = await t.svc.markPublished({ projectId: 'blog', id: a.id, link: 'https://x.io/a' })
    expect(r.ok && r.value.status).toBe('reapproval-required')
    const [after] = await t.scan()
    expect(after).toMatchObject({ status: 'draft', approvedAt: null, approvedBy: null })
    expect(after.note).toContain('다시 승인')
    expect(after.hash).not.toBe(a.hash)
  })

  it('scan reverts approved drafts whose content changed', async () => {
    const t = await setup()
    await t.draft('a.md', '# A')
    const [a] = await t.scan()
    await approve(t, a.id)
    await t.draft('a.md', '# A2')
    expect((await t.scan())[0].status).toBe('draft')
  })

  it('calls the connected adapter (main code) with the pinned hash; failure is recorded without detail', async () => {
    const ok = createFakePublisher('blog-x')
    const t = await setup({ adapter: 'blog-x', publishers: new Map([['blog-x', ok]]) })
    await t.draft('a.md', '# A')
    const [a] = await t.scan()
    await approve(t, a.id)
    const r = await t.svc.publish({ projectId: 'blog', id: a.id })
    expect(r.ok && r.value.status).toBe('published')
    expect(ok.requests).toHaveLength(1)
    expect(ok.requests[0]).toMatchObject({
      draftPath: 'a.md',
      draftHash: a.hash,
      adapterId: 'blog-x'
    })

    const bad = createFakePublisher('blog-x', { ok: false, code: 'auth' })
    const t2 = await setup({ adapter: 'blog-x', publishers: new Map([['blog-x', bad]]) })
    await t2.draft('a.md', '# A')
    const [b] = await t2.scan()
    await approve(t2, b.id)
    const f = await t2.svc.publish({ projectId: 'blog', id: b.id })
    expect(f.ok && f.value).toMatchObject({ status: 'failed' })
  })

  it('rejects malformed requests and unknown projects', async () => {
    const t = await setup()
    expect(await t.svc.list({ projectId: '../x' })).toMatchObject({
      ok: false,
      code: 'invalid-request'
    })
    expect(await t.svc.requestPublish({ projectId: 'blog', id: 'zz' })).toMatchObject({ ok: false })
    expect(await t.svc.scan({ projectId: 'nope' })).toMatchObject({ ok: false, code: 'not-found' })
    expect(
      await t.svc.markPublished({ projectId: 'blog', id: '0123456789ab', extra: 1 })
    ).toMatchObject({ ok: false, code: 'invalid-request' })
  })
})

describe('link format', () => {
  it('accepts only plain https urls', () => {
    expect(isPublishLink('https://a.b/c?d=1#e')).toBe(true)
    for (const v of [
      'http://a.b',
      'ftp://a.b',
      'https://',
      'https://a.b/ x',
      'https://a:b@c.d',
      ''
    ])
      expect(isPublishLink(v)).toBe(false)
  })
})
