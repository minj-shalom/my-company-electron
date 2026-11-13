import { randomUUID } from 'node:crypto'
import { CHAT_MAX_HISTORY, type ChatMessage, type ChatRef } from '../../shared/chat'
import { SESSION_ID } from '../providers/session-id'
import type { StateStore } from '../gate/state-store'

const MAX_TEXT = 20_000
const MAX_REFS = 10
const MAX_TITLE = 200

interface Stored {
  version: 1
  sessionId: string | null
  messages: ChatMessage[]
}

const isRef = (v: unknown): v is ChatRef => {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return (
    (r['kind'] === 'decision' || r['kind'] === 'briefing') &&
    typeof r['id'] === 'string' &&
    r['id'].length <= 100 &&
    typeof r['title'] === 'string'
  )
}

function parseMessage(v: unknown): ChatMessage | null {
  if (typeof v !== 'object' || v === null) return null
  const m = v as Record<string, unknown>
  if (typeof m['id'] !== 'string' || typeof m['text'] !== 'string') return null
  if (m['role'] !== 'ceo' && m['role'] !== 'coo') return null
  if (m['status'] !== 'ok' && m['status'] !== 'failed' && m['status'] !== 'cancelled') return null
  if (typeof m['at'] !== 'number' || !Number.isFinite(m['at'])) return null
  const refs = Array.isArray(m['refs']) ? m['refs'].filter(isRef).slice(0, MAX_REFS) : []
  return {
    id: m['id'].slice(0, 64),
    role: m['role'],
    text: m['text'].slice(0, MAX_TEXT),
    at: m['at'],
    status: m['status'],
    refs: refs.map((r) => ({ ...r, title: r.title.slice(0, MAX_TITLE) }))
  }
}

/**
 * 대화 기록과 이어갈 세션 id. 앱 userData의 JSON이라 에이전트가 회사 폴더에서 바꿀 수 없다.
 * 깨진 파일은 빈 대화로 시작한다 (기록은 편의 정보이고 원본이 아니다). 쓰기는 직렬화한다.
 */
export class ChatHistory {
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly store: StateStore) {}

  private async read(): Promise<Stored> {
    let raw: unknown
    try {
      raw = await this.store.load()
    } catch {
      raw = null
    }
    const o = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
    const messages = Array.isArray(o['messages'])
      ? o['messages']
          .map(parseMessage)
          .filter((m): m is ChatMessage => m !== null)
          .slice(-CHAT_MAX_HISTORY)
      : []
    const sid = o['sessionId']
    return {
      version: 1,
      sessionId: typeof sid === 'string' && SESSION_ID.test(sid) ? sid : null,
      messages
    }
  }

  private mutate<T>(fn: (s: Stored) => T): Promise<T> {
    const run = this.queue.then(async () => {
      const s = await this.read()
      const out = fn(s)
      s.messages = s.messages.slice(-CHAT_MAX_HISTORY)
      await this.store.save(s)
      return out
    })
    this.queue = run.catch(() => undefined)
    return run
  }

  async load(): Promise<{ messages: ChatMessage[]; sessionId: string | null }> {
    await this.queue
    const s = await this.read()
    return { messages: s.messages, sessionId: s.sessionId }
  }

  append(
    role: ChatMessage['role'],
    text: string,
    at: number,
    status: ChatMessage['status'] = 'ok',
    refs: ChatRef[] = [],
    id: string = randomUUID()
  ): Promise<ChatMessage> {
    const message: ChatMessage = {
      id,
      role,
      text: text.slice(0, MAX_TEXT),
      at,
      status,
      refs: refs.slice(0, MAX_REFS).map((r) => ({ ...r, title: r.title.slice(0, MAX_TITLE) }))
    }
    return this.mutate((s) => {
      s.messages.push(message)
      return message
    })
  }

  setSession(sessionId: string | null): Promise<void> {
    const ok = sessionId !== null && SESSION_ID.test(sessionId) ? sessionId : null
    return this.mutate((s) => {
      s.sessionId = ok
    })
  }

  clear(): Promise<void> {
    return this.mutate((s) => {
      s.messages = []
      s.sessionId = null
    })
  }
}
