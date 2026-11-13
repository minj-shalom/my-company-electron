import { randomUUID } from 'node:crypto'
import type {
  ChatEvent,
  ChatHistory as ChatHistoryView,
  ChatHrRequestResult,
  ChatHrStatusList,
  ChatReferences,
  ChatRef,
  ChatSendResult,
  ChatState
} from '../../shared/chat'
import type { ApiResult } from '../../shared/result'
import type { RunEvent } from '../../shared/run'
import type { ProviderAdapter } from '../providers/types'
import { SESSION_ID } from '../providers/session-id'
import type { SafeFs } from '../repository/safe-fs'
import { sharedRepository } from '../repository/shared-repository'
import { HrRequestRejected, hrRequestStatuses, submitHrRequest } from './chat-hr'
import type { ChatHistory } from './chat-history'
import { buildChatPrompt } from './chat-prompt'
import { validateChatMessage, validateHrRequestText } from './chat-validate'

export const CHAT_TIMEOUT_MS = 15 * 60 * 1000
const MAX_RESULT_CHARS = 20_000
const MAX_REFS = 10

export interface ChatServiceDeps {
  /** 열린 회사의 SafeFs. 회사가 없으면 던진다 (IPC 계층이 `no-company`로 바꾼다). */
  fs: () => SafeFs
  history: () => ChatHistory
  /** COO 실행용 어댑터. cwd는 회사 폴더. */
  createAdapter: (cwd: string) => Promise<ProviderAdapter>
  /** 자동 실행(틱)이 진행 중인지. 스케줄러 상태에서 읽는다. */
  isTickRunning: () => boolean
  /** 사용량 한도 점검. 없거나 실패하면 보내지 않는다 (틱과 같이 보수적). */
  checkLimit?: () => Promise<{ ok: boolean; reason: string }>
  /** 모든 창에 이벤트를 보낸다. */
  broadcast: (event: ChatEvent) => void
  now?: () => number
}

interface Active {
  messageId: string
  runId: string | null
  adapter: ProviderAdapter | null
  cancelled: boolean
}

type Fail = { ok: false; code: 'invalid-request' | 'conflict' | 'internal'; message: string }
const invalid = (message: string): Fail => ({ ok: false, code: 'invalid-request', message })

async function snapshot(
  fs: SafeFs
): Promise<{ decisions: Map<string, string>; reports: Map<string, string> }> {
  const repo = sharedRepository(fs)
  const decisions = new Map<string, string>()
  const reports = new Map<string, string>()
  try {
    for (const d of (await repo.listDecisions('pending')).items) decisions.set(d.id, d.title)
    for (const r of (await repo.listReports()).items)
      if (r.id.startsWith('briefing-')) reports.set(r.id, r.title)
  } catch {
    // 참조는 부가 정보다. 읽지 못하면 비워 둔다.
  }
  return { decisions, reports }
}

/**
 * CEO와 COO의 대화 한 줄기. 응답은 기존 어댑터 실행(`claude -p`)을 재사용하고, 세션 id를 보관해 다음 메시지에서 이어간다.
 * 자동 실행(틱)과는 동시에 돌지 않는다: 틱이 도는 중이면 보내지 않고 `tick-running`으로 알리며, 반대로 응답 중에는 `isBusy()`로 틱 시작을 막는다.
 * 확인과 점유는 await 없이 이어 붙여 틱 시작과 경쟁하지 않게 한다.
 */
export class ChatService {
  private active: Active | null = null

  constructor(private readonly deps: ChatServiceDeps) {}

  /** 스케줄러가 틱을 시작하기 전에 확인한다. */
  isBusy(): boolean {
    return this.active !== null
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }

  async getHistory(): Promise<ChatHistoryView> {
    const h = await this.deps.history().load()
    return { messages: h.messages, canResume: h.sessionId !== null }
  }

  async getState(): Promise<ChatState> {
    const h = await this.deps.history().load()
    return {
      runningMessageId: this.active?.messageId ?? null,
      tickRunning: this.deps.isTickRunning(),
      canResume: h.sessionId !== null
    }
  }

  async send(req: unknown): Promise<ApiResult<ChatSendResult>> {
    const text = validateChatMessage(req)
    if (text === null) return invalid('메시지가 비었거나 너무 깁니다.')
    if (this.active) return this.blocked('chat-running', '이미 응답을 만드는 중입니다.')
    if (this.deps.isTickRunning())
      return this.blocked('tick-running', '자동 실행이 진행 중입니다. 끝난 뒤 다시 보내 주세요.')
    // 한도 점검 await 동안 다른 전송이 끼어들지 못하게 자리를 먼저 잡는다.
    const messageId = randomUUID()
    const slot: Active = { messageId, runId: null, adapter: null, cancelled: false }
    this.active = slot
    try {
      const limit = await this.checkLimit()
      if (!limit.ok) {
        this.release(slot)
        return this.blocked('limit', limit.reason)
      }
      const fs = this.deps.fs()
      const history = this.deps.history()
      const prior = await history.load()
      await history.append('ceo', text, this.now())
      const before = await snapshot(fs)
      const adapter = await this.deps.createAdapter(fs.root)
      slot.adapter = adapter
      const resume =
        adapter.id === 'claude' && prior.sessionId !== null ? prior.sessionId : undefined
      const started = this.start(slot, adapter, buildChatPrompt(text), resume, before, fs)
      if (!started.ok) {
        this.release(slot)
        await this.finish(slot.messageId, '응답을 시작하지 못했어요.', 'failed', [])
        return this.blocked('unavailable', '제공자 CLI를 시작하지 못했습니다.')
      }
      slot.runId = started.runId
      if (slot.cancelled) adapter.cancel(started.runId)
      this.deps.broadcast({ type: 'started', messageId, runId: started.runId })
      return { ok: true, value: { started: true, messageId, runId: started.runId } }
    } catch {
      this.release(slot)
      return { ok: false, code: 'internal', message: '메시지를 보내지 못했습니다.' }
    }
  }

  private blocked(
    reason: Extract<ChatSendResult, { started: false }>['reason'],
    message: string
  ): ApiResult<ChatSendResult> {
    return { ok: true, value: { started: false, reason, message } }
  }

  private async checkLimit(): Promise<{ ok: boolean; reason: string }> {
    if (!this.deps.checkLimit)
      return { ok: false, reason: '한도 점검이 연결되지 않아 보내지 않았어요.' }
    try {
      return await this.deps.checkLimit()
    } catch {
      return { ok: false, reason: '한도 점검에 실패해 보내지 않았어요.' }
    }
  }

  private release(slot: Active): void {
    if (this.active === slot) this.active = null
  }

  private start(
    slot: Active,
    adapter: ProviderAdapter,
    prompt: string,
    resume: string | undefined,
    before: Awaited<ReturnType<typeof snapshot>>,
    fs: SafeFs
  ): ReturnType<ProviderAdapter['start']> {
    let sessionId: string | null = null
    let resultText: string | null = null
    let resultFailed = false
    let error: string | null = null
    const blocks: string[] = []
    const emit = (ev: RunEvent): void => {
      switch (ev.type) {
        case 'start':
          sessionId = ev.sessionId
          break
        case 'message':
          if (ev.role === 'assistant' && ev.text !== '') {
            blocks.push(ev.text)
            this.deps.broadcast({
              type: 'text',
              messageId: slot.messageId,
              text: ev.text.slice(0, MAX_RESULT_CHARS)
            })
          }
          break
        case 'tool_use':
          this.deps.broadcast({
            type: 'tool',
            messageId: slot.messageId,
            name: ev.name.slice(0, 64)
          })
          break
        case 'result':
          resultText = ev.text
          resultFailed = !ev.success
          break
        case 'error':
          error ??= ev.code
          break
        case 'exit':
          void this.complete(
            slot,
            { sessionId, resultText, resultFailed, error, blocks, resume },
            before,
            fs
          )
          break
        default:
          // 로그와 stderr 원문은 renderer로 보내지 않는다.
          break
      }
    }
    return adapter.start(
      { prompt, timeoutMs: CHAT_TIMEOUT_MS },
      emit,
      resume !== undefined ? { resumeSessionId: resume } : {}
    )
  }

  private async complete(
    slot: Active,
    r: {
      sessionId: string | null
      resultText: string | null
      resultFailed: boolean
      error: string | null
      blocks: string[]
      resume: string | undefined
    },
    before: Awaited<ReturnType<typeof snapshot>>,
    fs: SafeFs
  ): Promise<void> {
    try {
      const history = this.deps.history()
      const failed = r.error !== null || r.resultFailed
      const cancelled = r.error === 'cancelled' || slot.cancelled
      // 세션은 성공한 응답에서만 갱신한다. 재개에 실패했으면 다음 전송이 새 세션으로 시작하도록 지운다.
      if (!failed && r.sessionId !== null && SESSION_ID.test(r.sessionId))
        await history.setSession(r.sessionId)
      else if (failed && r.resume !== undefined && !cancelled) await history.setSession(null)
      const text = (r.resultText ?? r.blocks.join('\n\n')).slice(0, MAX_RESULT_CHARS)
      const status = cancelled ? 'cancelled' : failed ? 'failed' : 'ok'
      const body =
        status === 'ok'
          ? text || '(응답이 비었어요.)'
          : status === 'cancelled'
            ? '응답을 취소했어요.'
            : r.error === 'timeout'
              ? '시간이 초과돼 중단했어요.'
              : r.error === 'cli-not-found'
                ? 'CLI를 찾지 못해 실행하지 못했어요.'
                : '응답을 만들지 못했어요.'
      const refs = status === 'ok' || text !== '' ? await this.newRefs(before, fs) : []
      await this.finish(slot.messageId, body, status, refs)
    } catch {
      this.deps.broadcast({
        type: 'done',
        message: {
          id: slot.messageId,
          role: 'coo',
          text: '응답을 저장하지 못했어요.',
          at: this.now(),
          status: 'failed',
          refs: []
        }
      })
    } finally {
      this.release(slot)
    }
  }

  private async finish(
    id: string,
    text: string,
    status: 'ok' | 'failed' | 'cancelled',
    refs: ChatRef[]
  ): Promise<void> {
    const message = await this.deps.history().append('coo', text, this.now(), status, refs, id)
    this.deps.broadcast({ type: 'done', message })
  }

  /** 이 응답을 만드는 동안 새로 생긴 결정 카드와 브리핑. */
  private async newRefs(
    before: Awaited<ReturnType<typeof snapshot>>,
    fs: SafeFs
  ): Promise<ChatRef[]> {
    const after = await snapshot(fs)
    const out: ChatRef[] = []
    for (const [id, title] of after.decisions)
      if (!before.decisions.has(id)) out.push({ kind: 'decision', id, title })
    for (const [id, title] of after.reports)
      if (!before.reports.has(id)) out.push({ kind: 'briefing', id, title })
    return out.slice(0, MAX_REFS)
  }

  cancel(): boolean {
    const a = this.active
    if (!a) return false
    a.cancelled = true
    if (a.adapter !== null && a.runId !== null) a.adapter.cancel(a.runId)
    return true
  }

  async reset(): Promise<ApiResult<{ cleared: true }> | Fail> {
    if (this.active)
      return { ok: false, code: 'conflict', message: '응답을 만드는 중에는 지울 수 없습니다.' }
    await this.deps.history().clear()
    return { ok: true, value: { cleared: true } }
  }

  async references(): Promise<ChatReferences> {
    const s = await snapshot(this.deps.fs())
    const toRefs = (m: Map<string, string>, kind: ChatRef['kind']): ChatRef[] =>
      [...m]
        .map(([id, title]) => ({ kind, id, title }))
        .reverse()
        .slice(0, 20)
    return {
      decisions: toRefs(s.decisions, 'decision'),
      briefings: toRefs(s.reports, 'briefing').slice(0, 5)
    }
  }

  async requestHr(req: unknown): Promise<ApiResult<ChatHrRequestResult>> {
    const text = validateHrRequestText(req)
    if (text === null) return invalid('인사 지시가 비었거나 너무 깁니다.')
    try {
      return { ok: true, value: await submitHrRequest(this.deps.fs(), text) }
    } catch (e) {
      if (e instanceof HrRequestRejected)
        return e.code === 'too-many'
          ? { ok: false, code: 'conflict', message: '처리 중인 인사 요청이 너무 많습니다.' }
          : invalid('인사 지시가 올바르지 않습니다.')
      return { ok: false, code: 'internal', message: '인사 지시를 접수하지 못했습니다.' }
    }
  }

  async hrStatuses(): Promise<ChatHrStatusList> {
    const fs = this.deps.fs()
    let approvals: number
    try {
      approvals = (await sharedRepository(fs).listDecisions('pending')).items.filter(
        (d) => d.kind === 'proposal'
      ).length
    } catch {
      approvals = 0
    }
    return hrRequestStatuses(fs, approvals)
  }
}
