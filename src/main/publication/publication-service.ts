import { createHash } from 'node:crypto'
import type { ApiResult, DomainErrorCode } from '../../shared/result'
import { GATE_FAILURE_NOTES } from '../../shared/publisher'
import type { PolicyState } from '../../shared/policy'
import {
  MAX_APPROVAL_BATCH,
  MAX_PUBLICATION_ENTRIES,
  MAX_REASON,
  type PublicationDraftContent,
  type PublicationEntry,
  type PublicationList,
  type PublicationProgress,
  type PublicationPublishResult,
  type PublicationRequestApprovalResult
} from '../../shared/publication'
import { leadingId } from '../repository/ids'
import { FsGuardError, MAX_FILE_BYTES, type SafeFs } from '../repository/safe-fs'
import type { GateCards } from '../gate/gate-cards'
import type { Publisher } from '../gate/publisher'
import { dayOf, type DayClock } from '../recurring/recurring-schedule'
import { OutputPathError, listDrafts, readDraft, type DraftFile } from './output-reader'
import {
  cleanLine,
  entryId,
  parsePublishing,
  publishingFile,
  serializePublishing,
  type ParsedPublishing
} from './publication-doc'
import {
  parseItem,
  parseMarkPublished,
  parseProject,
  parseRead,
  parseRequestApproval
} from './publication-input'

export interface PublicationProjectRef {
  /** 프로젝트 폴더 실제 경로. */
  dir: string
  archived: boolean
}

export interface PublicationServiceDeps {
  fs: SafeFs
  /** 회사 폴더 쓰기 직렬화 큐 (카드 생성도 같은 큐를 쓰므로 큐 안에서 카드를 만들지 않는다). */
  exclusive: <T>(task: () => Promise<T>) => Promise<T>
  project: (projectId: string) => Promise<PublicationProjectRef | null>
  policy: (projectId: string) => Promise<PolicyState | null>
  cards: GateCards
  /** 어댑터 id -> 구현 (T-054가 채운다). 비어 있으면 `manual`만 동작한다. */
  publishers?: ReadonlyMap<string, Publisher>
  clock: DayClock
}

const fail = (code: DomainErrorCode, message: string): ApiResult<never> => ({
  ok: false,
  code,
  message
})
const UNREADABLE_MSG =
  '읽을 수 없는 발행 기록이 있어 앱에서 수정할 수 없습니다. 파일을 먼저 고쳐 주세요.'
const NOT_FOUND = '발행 항목을 찾을 수 없습니다.'
const PUBLISH_TIMEOUT_MS = 60_000
const FAIL_NOTE: Record<string, string> = GATE_FAILURE_NOTES

const sha = (s: string): string => createHash('sha256').update(s).digest('hex')
const isoDay = (iso: string | null, tz: string | undefined): string | null =>
  iso === null ? null : dayOf(new Date(iso), tz).date

/** 마크다운 첫 `# ` 제목, 없으면 파일 이름. 신뢰하지 않는 텍스트라 한 줄로 정리한다. */
function titleOf(d: DraftFile): string {
  const h = /^#[ \t]+(.+)$/m.exec(d.text)
  const raw = h ? h[1] : (d.path.split('/').pop() ?? d.path).replace(/\.md$/, '')
  return cleanLine(raw, 200) || d.path
}

/** 읽기 실패를 고정 문구로 바꾼다 (경로·오류 원문 비노출). */
function draftError(e: unknown): ApiResult<never> {
  if (e instanceof OutputPathError)
    return e.message === 'missing'
      ? fail('not-found', '초안을 찾을 수 없습니다.')
      : e.message === 'too-large'
        ? fail('invalid-request', '초안이 1MB를 넘어 열 수 없습니다.')
        : fail('invalid-request', '초안 경로가 올바르지 않습니다.')
  return fail('internal', '초안을 읽지 못했습니다.')
}

/**
 * 산출물 열람과 발행 기록(T-050). 직원(LLM)은 초안 파일만 만들고, 승인·발행 상태는 이 서비스(앱 main)만 쓴다.
 * 승인은 내용 해시에 고정되며 발행 시점에 해시가 다르면 항목을 draft로 되돌려 재승인을 요구한다.
 */
export class PublicationService {
  /** 발행 중인 항목 (같은 항목의 동시 호출이 어댑터를 두 번 부르지 않게 한다). */
  private readonly publishing = new Set<string>()

  constructor(private readonly deps: PublicationServiceDeps) {}

  private now(): Date {
    return this.deps.clock.now()
  }
  private today(): string {
    return dayOf(this.now(), this.deps.clock.timeZone).date
  }

  private async load(projectId: string): Promise<ParsedPublishing> {
    try {
      return parsePublishing(await this.deps.fs.readText(publishingFile(projectId)))
    } catch (e) {
      if (e instanceof FsGuardError && e.kind === 'missing') return parsePublishing(null)
      throw e
    }
  }

  private async ref(projectId: string): Promise<PublicationProjectRef | null> {
    const p = await this.deps.project(projectId)
    return p === null || p.archived ? null : p
  }

  private outputDir(policy: PolicyState | null): string {
    return (policy?.values.outputDir ?? 'drafts/').replace(/\/+$/, '')
  }

  async list(raw: unknown): Promise<ApiResult<PublicationList>> {
    const p = parseProject(raw)
    if (!p.ok) return fail('invalid-request', p.message)
    try {
      const doc = await this.load(p.value.projectId)
      return {
        ok: true,
        value: {
          projectId: p.value.projectId,
          items: doc.entries,
          unreadable: doc.unreadable
        }
      }
    } catch {
      return fail('internal', '발행 기록을 읽지 못했습니다.')
    }
  }

  async readDraftContent(raw: unknown): Promise<ApiResult<PublicationDraftContent>> {
    const p = parseRead(raw)
    if (!p.ok) return fail('invalid-request', p.message)
    try {
      const project = await this.ref(p.value.projectId)
      if (project === null) return fail('not-found', '프로젝트를 찾을 수 없습니다.')
      const policy = await this.deps.policy(p.value.projectId)
      const d = await readDraft(project.dir, this.outputDir(policy), p.value.path)
      return { ok: true, value: { path: d.path, hash: d.hash, size: d.size, text: d.text } }
    } catch (e) {
      return draftError(e)
    }
  }

  /**
   * 읽기-수정-쓰기를 한 큐 안에서 한다. `edit`이 오류를 돌려주면 쓰지 않는다.
   * 읽을 수 없는 블록이 있으면 (원문은 보존하되) 쓰기를 거부한다.
   */
  private mutate<T>(
    projectId: string,
    edit: (doc: ParsedPublishing) => Promise<ApiResult<T>> | ApiResult<T>
  ): Promise<ApiResult<T>> {
    return this.deps.exclusive(async () => {
      try {
        const doc = await this.load(projectId)
        if (doc.unreadable > 0) return fail('conflict', UNREADABLE_MSG)
        const out = await edit(doc)
        if (!out.ok) return out
        const text = serializePublishing(doc.preface, doc.entries, doc.layout)
        if (Buffer.byteLength(text, 'utf8') > MAX_FILE_BYTES)
          return fail('invalid-request', '발행 기록이 너무 큽니다.')
        await this.deps.fs.writeText(publishingFile(projectId), text, true)
        return out
      } catch {
        return fail('internal', '발행 기록을 저장하지 못했습니다.')
      }
    })
  }

  /**
   * 산출물 폴더를 훑어 새 초안을 `draft`로 기록하고, 이미 기록된 초안의 내용이 바뀌었으면 다시 `draft`로 돌린다
   * (승인 이후 바뀐 내용은 재승인 대상). 발행을 마친 항목은 그대로 두고, 내용이 바뀌면 오늘 날짜의 새 항목을 만든다.
   */
  async scan(raw: unknown): Promise<ApiResult<PublicationList>> {
    const p = parseProject(raw)
    if (!p.ok) return fail('invalid-request', p.message)
    const { projectId } = p.value
    let files: DraftFile[]
    try {
      const project = await this.ref(projectId)
      if (project === null) return fail('not-found', '프로젝트를 찾을 수 없습니다.')
      const outDir = this.outputDir(await this.deps.policy(projectId))
      files = []
      for (const rel of await listDrafts(project.dir, outDir)) {
        try {
          files.push(await readDraft(project.dir, outDir, rel))
        } catch {
          // 읽을 수 없는 초안(1MB 초과, 링크 등)은 기록하지 않는다.
        }
      }
    } catch (e) {
      return draftError(e)
    }
    const today = this.today()
    return this.mutate(projectId, (doc) => {
      for (const f of files) {
        const same = doc.entries.filter((e) => e.path === f.path)
        const latest = same[same.length - 1]
        if (latest === undefined || (latest.status === 'published' && latest.hash !== f.hash)) {
          if (doc.entries.length >= MAX_PUBLICATION_ENTRIES) continue
          const id = entryId(today, f.path)
          if (doc.entries.some((e) => e.id === id)) continue
          doc.entries.push(blank(id, today, f))
        } else if (latest.hash !== f.hash && latest.status !== 'published') {
          const wasApproved = latest.approvedAt !== null
          Object.assign(latest, {
            title: titleOf(f),
            hash: f.hash,
            status: 'draft',
            approvedAt: null,
            approvedBy: null,
            requestedAt: null,
            cardId: null,
            note: wasApproved ? '승인 이후 내용이 바뀌어 다시 승인해야 합니다.' : null
          } satisfies Partial<PublicationEntry>)
        }
      }
      return {
        ok: true,
        value: { projectId, items: doc.entries, unreadable: doc.unreadable }
      } satisfies ApiResult<PublicationList>
    })
  }

  private async pendingCards(): Promise<Set<string>> {
    const { files } = await this.deps.fs.listMarkdown('company/decisions/pending')
    const ids = new Set<string>()
    for (const f of files) {
      const id = leadingId(f, 'D')
      if (id !== null) ids.add(id)
    }
    return ids
  }

  /**
   * 승인 대기 초안에 대해 승인 모드에 따라 `content-approval` 카드를 만든다.
   * 매번 컨펌은 초안마다, 묶음 컨펌은 한 장, 자동은 카드 없이 T-053 게이트가 승인을 기록한다.
   * 카드에는 경로와 해시 앞부분만 넣는다 (초안 제목·본문은 신뢰할 수 없는 텍스트).
   */
  async requestApproval(raw: unknown): Promise<ApiResult<PublicationRequestApprovalResult>> {
    const p = parseRequestApproval(raw)
    if (!p.ok) return fail('invalid-request', p.message)
    const { projectId, ids, ticketId } = p.value
    try {
      if ((await this.ref(projectId)) === null)
        return fail('not-found', '프로젝트를 찾을 수 없습니다.')
      const mode = (await this.deps.policy(projectId))?.effective.modes['draft-approve'] ?? 'every'
      const doc = await this.load(projectId)
      const pending = await this.pendingCards()
      const open = doc.entries.filter(
        (e) => e.status === 'draft' && (ids === null || ids.includes(e.id))
      )
      const eligible = open.filter((e) => e.cardId === null || !pending.has(e.cardId))
      const targets = eligible.slice(0, MAX_APPROVAL_BATCH)
      const result: PublicationRequestApprovalResult = {
        cardIds: [],
        autoPending: 0,
        skipped: (ids === null ? open.length : ids.length) - targets.length
      }
      if (targets.length === 0) return { ok: true, value: result }
      if (mode === 'auto') {
        result.autoPending = targets.length
        return { ok: true, value: result }
      }
      const groups = mode === 'batch' ? [targets] : targets.map((t) => [t])
      const made: Array<{ cardId: string; entryIds: string[] }> = []
      for (const g of groups) {
        const label = g.length === 1 ? g[0].path : `${g[0].path} 외 ${g.length - 1}건`
        const hashes = g.map((e) => `${e.path}@${e.hash.slice(0, 7)}`).join(', ')
        const cardId = await this.deps.cards.create({
          kind: 'content-approval',
          title: `초안 승인 (${projectId}): ${label}`,
          ticketId: ticketId ?? g[0].ticketId,
          question: `${projectId} 프로젝트의 초안 ${g.length}건을 승인할까요? ${hashes}`,
          options: [
            { key: 'A', label: '승인', description: '이 내용(해시 고정)만 발행할 수 있게 됩니다.' },
            { key: 'B', label: '거절', description: '사유와 함께 수정하도록 되돌립니다.' }
          ],
          impact: '승인한 뒤 초안이 바뀌면 다시 승인해야 하며, 발행은 별도로 요청합니다.',
          reason: mode === 'batch' ? '승인 모드가 묶음 컨펌입니다.' : '승인 모드가 매번 컨펌입니다.'
        })
        made.push({ cardId, entryIds: g.map((e) => e.id) })
        result.cardIds.push(cardId)
      }
      const attached = await this.mutate(projectId, (d) => {
        for (const m of made)
          for (const id of m.entryIds) {
            const e = d.entries.find((x) => x.id === id)
            if (e !== undefined && e.status === 'draft') {
              e.cardId = m.cardId
              if (ticketId !== null) e.ticketId = ticketId
            }
          }
        return { ok: true, value: null } satisfies ApiResult<null>
      })
      if (!attached.ok) return attached
      return { ok: true, value: result }
    } catch {
      return fail('internal', '승인 요청을 만들지 못했습니다.')
    }
  }

  /** 카드 제목(`초안 승인 (<프로젝트 id>): ...`)에서 프로젝트 id를 읽는다. 앱이 만든 카드 형식이 아니면 null. */
  private async cardProject(cardId: string): Promise<string | null> {
    for (const dir of ['company/decisions/done', 'company/decisions/pending']) {
      const { files } = await this.deps.fs.listMarkdown(dir)
      const f = files.find((n) => leadingId(n, 'D') === cardId)
      if (f === undefined) continue
      const text = await this.deps.fs.readText(`${dir}/${f}`).catch(() => '')
      const m = new RegExp(`^# ${cardId}: 초안 승인 \\(([a-z0-9-]+)\\):`).exec(text)
      return m ? m[1] : null
    }
    return null
  }

  /**
   * 승인 카드가 처리되면 호출한다 (결정 처리 경로). A는 승인, B는 거절(사유는 결정 메모).
   * 승인은 기록된 해시와 지금 파일 내용이 같을 때만 한다. 다르면 승인하지 않고 draft로 남긴다.
   */
  async onCardResolved(cardId: string, choice: string, memo: string | null): Promise<void> {
    if (choice !== 'A' && choice !== 'B') return
    const cardProject = await this.cardProject(cardId)
    if (cardProject === null) return
    const { files } = await this.deps.fs.listMarkdown('company/publishing')
    for (const f of files) {
      const projectId = f.replace(/\.md$/, '')
      // 카드가 다른 프로젝트의 것이면 이 기록에 반영하지 않는다 (기록 파일의 카드 번호 위조 방지).
      if (projectId !== cardProject) continue
      const doc = await this.load(projectId).catch(() => null)
      if (doc === null || !doc.entries.some((e) => e.cardId === cardId && e.status === 'draft'))
        continue
      const project = await this.ref(projectId)
      const outDir = this.outputDir(await this.deps.policy(projectId))
      const current = new Map<string, string | null>()
      for (const e of doc.entries.filter((x) => x.cardId === cardId && x.status === 'draft')) {
        let h: string | null = null
        if (choice === 'A' && project !== null)
          h = await readDraft(project.dir, outDir, e.path).then(
            (d) => d.hash,
            () => null
          )
        current.set(e.id, h)
      }
      const nowIso = this.now().toISOString()
      await this.mutate(projectId, (d) => {
        for (const e of d.entries) {
          if (e.cardId !== cardId || e.status !== 'draft' || !current.has(e.id)) continue
          if (choice === 'B') {
            e.status = 'rejected'
            e.note = memo !== null && memo !== '' ? cleanLine(memo, MAX_REASON) : '거절됨'
          } else if (current.get(e.id) === e.hash) {
            e.status = 'approved'
            e.approvedAt = nowIso
            e.approvedBy = 'ceo'
            e.note = null
          } else {
            e.note = '승인 시점에 내용이 달라져 승인하지 않았습니다. 다시 승인을 요청하세요.'
          }
        }
        return { ok: true, value: null } satisfies ApiResult<null>
      })
    }
  }

  /**
   * 자동 모드 승인 기록(T-053 게이트 전용, IPC 아님). 정책의 유효한 `auto`이고 파일 내용이 기록과 같을 때만 `auto`로 승인한다.
   */
  async recordAutoApproval(projectId: string, id: string): Promise<ApiResult<PublicationEntry>> {
    const item = parseItem({ projectId, id })
    if (!item.ok) return fail('invalid-request', item.message)
    try {
      const policy = await this.deps.policy(projectId)
      if (policy?.effective.modes['draft-approve'] !== 'auto' || policy.activation === null)
        return fail('forbidden', '자동 승인 모드가 아닙니다.')
      const project = await this.ref(projectId)
      if (project === null) return fail('not-found', '프로젝트를 찾을 수 없습니다.')
      const doc = await this.load(projectId)
      const e = doc.entries.find((x) => x.id === id)
      if (e === undefined) return fail('not-found', NOT_FOUND)
      const h = await readDraft(project.dir, this.outputDir(policy), e.path).then(
        (d) => d.hash,
        () => null
      )
      if (e.status !== 'draft' || h !== e.hash)
        return fail('conflict', '자동 승인할 수 없는 상태입니다.')
      const nowIso = this.now().toISOString()
      return await this.mutate(projectId, (d) => {
        const t = d.entries.find((x) => x.id === id)
        if (t === undefined || t.status !== 'draft' || t.hash !== h)
          return fail('conflict', '자동 승인할 수 없는 상태입니다.')
        Object.assign(t, { status: 'approved', approvedAt: nowIso, approvedBy: 'auto', note: null })
        return { ok: true, value: { ...t } }
      })
    } catch {
      return fail('internal', '승인을 기록하지 못했습니다.')
    }
  }

  /** 승인된 항목의 발행을 요청 상태로 고정한다 (해시는 승인 시점 값 그대로). */
  async requestPublish(raw: unknown): Promise<ApiResult<PublicationEntry>> {
    const p = parseItem(raw)
    if (!p.ok) return fail('invalid-request', p.message)
    const nowIso = this.now().toISOString()
    try {
      // 실패한 항목의 재시도도 해시를 다시 확인한다 (바뀌었으면 draft로 돌아가 재승인).
      const g = await this.guard(p.value.projectId, p.value.id)
      if (!g.ok) {
        if ('ok' in g.result) return g.result
        return fail('conflict', '승인 이후 내용이 바뀌어 다시 승인해야 합니다.')
      }
    } catch {
      return fail('internal', '발행을 요청하지 못했습니다.')
    }
    return this.mutate(p.value.projectId, (doc) => {
      const e = doc.entries.find((x) => x.id === p.value.id)
      if (e === undefined) return fail('not-found', NOT_FOUND)
      if (e.status !== 'approved' && e.status !== 'failed')
        return fail('conflict', '승인된 초안만 발행을 요청할 수 있습니다.')
      e.status = 'publish-requested'
      e.requestedAt = nowIso
      e.note = null
      return { ok: true, value: { ...e } }
    })
  }

  /**
   * 발행 시점 검사: 승인됐고(approved|publish-requested) 파일 해시가 승인 때와 같아야 한다.
   * 다르면 항목을 draft로 돌리고 `reapproval-required`.
   */
  private async guard(
    projectId: string,
    id: string
  ): Promise<
    | { ok: true; entry: PublicationEntry; policy: PolicyState | null }
    | {
        ok: false
        result: ApiResult<never> | { status: 'reapproval-required'; entry: PublicationEntry }
      }
  > {
    const project = await this.ref(projectId)
    if (project === null)
      return { ok: false, result: fail('not-found', '프로젝트를 찾을 수 없습니다.') }
    const doc = await this.load(projectId)
    const e = doc.entries.find((x) => x.id === id)
    if (e === undefined) return { ok: false, result: fail('not-found', NOT_FOUND) }
    if (
      (e.status !== 'approved' && e.status !== 'publish-requested' && e.status !== 'failed') ||
      e.approvedAt === null ||
      e.approvedBy === null
    )
      return { ok: false, result: fail('conflict', '승인된 초안만 발행할 수 있습니다.') }
    const policy = await this.deps.policy(projectId)
    const h = await readDraft(project.dir, this.outputDir(policy), e.path).then(
      (d) => d.hash,
      () => null
    )
    if (h === e.hash) return { ok: true, entry: e, policy }
    const reverted = await this.mutate(projectId, (d) => {
      const t = d.entries.find((x) => x.id === id)
      if (t === undefined) return fail('not-found', NOT_FOUND)
      Object.assign(t, {
        status: 'draft',
        approvedAt: null,
        approvedBy: null,
        requestedAt: null,
        cardId: null,
        note: '승인 이후 내용이 바뀌어 발행하지 않았습니다. 다시 승인해야 합니다.',
        ...(h !== null ? { hash: h } : {})
      } satisfies Partial<PublicationEntry>)
      return { ok: true, value: { ...t } }
    })
    return reverted.ok
      ? { ok: false, result: { status: 'reapproval-required', entry: reverted.value } }
      : { ok: false, result: reverted }
  }

  /**
   * 발행 실행 호출부 (main 코드, LLM 경로 아님). 정책의 어댑터가 연결돼 있으면 계약의 `publish()`를 호출하고,
   * `manual`이거나 어댑터가 없으면 CEO가 직접 게시한 뒤 `markPublished`를 쓰도록 `manual-required`를 돌려준다.
   */
  async publish(raw: unknown): Promise<ApiResult<PublicationPublishResult>> {
    const p = parseItem(raw)
    if (!p.ok) return fail('invalid-request', p.message)
    const { projectId, id } = p.value
    const lock = `${projectId}:${id}`
    if (this.publishing.has(lock)) return fail('conflict', '이미 발행을 처리하고 있습니다.')
    this.publishing.add(lock)
    try {
      const g = await this.guard(projectId, id)
      if (!g.ok) {
        return 'ok' in g.result ? g.result : { ok: true, value: g.result }
      }
      const adapterId = g.policy?.values.publishAdapter ?? 'manual'
      const publisher = adapterId === 'manual' ? undefined : this.deps.publishers?.get(adapterId)
      if (publisher === undefined)
        return { ok: true, value: { status: 'manual-required', entry: g.entry } }
      const ctl = new AbortController()
      const timer = setTimeout(() => ctl.abort(), PUBLISH_TIMEOUT_MS)
      let outcome: Awaited<ReturnType<Publisher['publish']>>
      try {
        outcome = await publisher.publish(
          {
            projectId,
            adapterId,
            draftPath: g.entry.path,
            draftHash: g.entry.hash,
            idempotencyKey: sha(`publication|${projectId}|${adapterId}|${g.entry.hash}`)
          },
          ctl.signal
        )
      } catch {
        outcome = { ok: false, code: 'unknown' }
      } finally {
        clearTimeout(timer)
      }
      const nowIso = this.now().toISOString()
      const saved = await this.mutate(projectId, (d) => {
        const t = d.entries.find((x) => x.id === id)
        if (t === undefined) return fail('not-found', NOT_FOUND)
        if (outcome.ok) {
          t.status = 'published'
          t.publishedAt = nowIso
          t.note = null
        } else {
          t.status = 'failed'
          t.note = FAIL_NOTE[outcome.code] ?? FAIL_NOTE.unknown
        }
        return { ok: true, value: { ...t } }
      })
      return saved.ok
        ? { ok: true, value: { status: outcome.ok ? 'published' : 'failed', entry: saved.value } }
        : saved
    } catch {
      return fail('internal', '발행을 처리하지 못했습니다.')
    } finally {
      this.publishing.delete(lock)
    }
  }

  /**
   * CEO가 직접 게시한 뒤 "발행함"을 기록한다. 링크는 텍스트로만 저장하고 앱은 열거나 접속하지 않는다.
   * 승인(approved|publish-requested)과 해시 일치가 없으면 `published`가 될 수 없다.
   */
  async markPublished(raw: unknown): Promise<ApiResult<PublicationPublishResult>> {
    const p = parseMarkPublished(raw)
    if (!p.ok) return fail('invalid-request', p.message)
    const { projectId, id, link } = p.value
    try {
      const g = await this.guard(projectId, id)
      if (!g.ok) return 'ok' in g.result ? g.result : { ok: true, value: g.result }
      const nowIso = this.now().toISOString()
      const saved = await this.mutate(projectId, (d) => {
        const t = d.entries.find((x) => x.id === id)
        if (t === undefined) return fail('not-found', NOT_FOUND)
        if (t.status !== 'approved' && t.status !== 'publish-requested')
          return fail('conflict', '승인된 초안만 발행함으로 표시할 수 있습니다.')
        t.status = 'published'
        t.publishedAt = nowIso
        t.link = link
        t.note = null
        return { ok: true, value: { ...t } }
      })
      return saved.ok ? { ok: true, value: { status: 'published', entry: saved.value } } : saved
    } catch {
      return fail('internal', '발행 표시를 저장하지 못했습니다.')
    }
  }

  async progress(raw: unknown): Promise<ApiResult<PublicationProgress>> {
    const p = parseProject(raw)
    if (!p.ok) return fail('invalid-request', p.message)
    try {
      const doc = await this.load(p.value.projectId)
      const policy = await this.deps.policy(p.value.projectId)
      const tz = this.deps.clock.timeZone
      const date = this.today()
      return {
        ok: true,
        value: {
          projectId: p.value.projectId,
          date,
          goal: policy?.values.dailyOutputGoal ?? 0,
          approvedToday: doc.entries.filter((e) => isoDay(e.approvedAt, tz) === date).length,
          publishedToday: doc.entries.filter((e) => isoDay(e.publishedAt, tz) === date).length
        }
      }
    } catch {
      return fail('internal', '진행 상황을 읽지 못했습니다.')
    }
  }
}

function blank(id: string, date: string, f: DraftFile): PublicationEntry {
  return {
    id,
    date,
    title: titleOf(f),
    path: f.path,
    hash: f.hash,
    status: 'draft',
    approvedAt: null,
    approvedBy: null,
    requestedAt: null,
    publishedAt: null,
    link: null,
    ticketId: null,
    cardId: null,
    note: null
  }
}
