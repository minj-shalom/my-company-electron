import type { WindowApi } from '../../shared/api'
import {
  CHAT_MAX_HR_REQUEST_CHARS,
  CHAT_MAX_MESSAGE_CHARS,
  type ChatEvent,
  type ChatHrRequestInfo,
  type ChatMessage
} from '../../shared/chat'

/**
 * 브라우저 개발 모드 전용. `?mock-chat=idle|tick-running`.
 * - idle: 보내면 짧은 스트림 뒤에 결정 카드와 브리핑 링크가 달린 응답이 온다.
 * - tick-running: 자동 실행 중이라 보내기가 `tick-running`으로 막힌다.
 */
export type ChatScenario = 'idle' | 'tick-running'

export function parseChatScenario(search: string): ChatScenario {
  return new URLSearchParams(search).get('mock-chat') === 'tick-running' ? 'tick-running' : 'idle'
}

type Api = Pick<
  WindowApi,
  | 'sendChat'
  | 'cancelChat'
  | 'getChatHistory'
  | 'getChatState'
  | 'resetChat'
  | 'getChatReferences'
  | 'requestHrInstruction'
  | 'getHrInstructionStatuses'
  | 'onChatEvent'
>

const STEP_MS = 400

export function createMockChatApi(scenario: ChatScenario, stepMs = STEP_MS): Api {
  const listeners = new Set<(e: ChatEvent) => void>()
  const emit = (e: ChatEvent): void => listeners.forEach((l) => l(e))
  let messages: ChatMessage[] = []
  let running: string | null = null
  let timers: ReturnType<typeof setTimeout>[] = []
  let seq = 0
  const hr: ChatHrRequestInfo[] = []
  const stages = ['pending', 'running', 'done'] as const
  const msg = (role: 'ceo' | 'coo', text: string, refs: ChatMessage['refs'] = []): ChatMessage => ({
    id: `mock-m-${++seq}`,
    role,
    text,
    at: Date.now(),
    status: 'ok',
    refs
  })
  const fail = (message: string) => ({ ok: false, code: 'invalid-request', message }) as const
  const textOf = (req: unknown, max: number): string | null => {
    const t = (req as { text?: unknown } | null)?.text
    return typeof t === 'string' && t.trim() !== '' && t.length <= max ? t.trim() : null
  }

  return {
    sendChat: async (req) => {
      const text = textOf(req, CHAT_MAX_MESSAGE_CHARS)
      if (text === null) return fail('메시지가 비었거나 너무 깁니다.')
      if (scenario === 'tick-running')
        return {
          ok: true,
          value: {
            started: false,
            reason: 'tick-running',
            message: '자동 실행이 진행 중입니다. 끝난 뒤 다시 보내 주세요.'
          }
        }
      if (running !== null)
        return {
          ok: true,
          value: { started: false, reason: 'chat-running', message: '이미 응답을 만드는 중입니다.' }
        }
      messages = [...messages, msg('ceo', text)]
      const id = `mock-m-${++seq}`
      running = id
      emit({ type: 'started', messageId: id, runId: 'mock-run' })
      const step = (n: number, fn: () => void): void => {
        timers.push(setTimeout(fn, stepMs * n))
      }
      step(1, () => emit({ type: 'text', messageId: id, text: '확인했어요. 티켓 현황을 볼게요.' }))
      step(2, () => emit({ type: 'tool', messageId: id, name: 'Read' }))
      step(3, () => {
        const done: ChatMessage = {
          id,
          role: 'coo',
          text: '정리했어요. 결정이 필요한 항목 하나와 브리핑을 남겼어요.',
          at: Date.now(),
          status: 'ok',
          refs: [
            { kind: 'decision', id: 'D-901', title: '(mock) 푸시 컨펌' },
            { kind: 'briefing', id: 'briefing-20260101090000', title: '(mock) 오전 브리핑' }
          ]
        }
        messages = [...messages, done]
        running = null
        emit({ type: 'done', message: done })
      })
      return { ok: true, value: { started: true, messageId: id, runId: 'mock-run' } }
    },
    cancelChat: async () => {
      if (running === null) return { ok: true, value: { cancelled: false } }
      timers.forEach(clearTimeout)
      timers = []
      const done: ChatMessage = {
        ...msg('coo', '응답을 취소했어요.'),
        id: running,
        status: 'cancelled'
      }
      messages = [...messages, done]
      running = null
      emit({ type: 'done', message: done })
      return { ok: true, value: { cancelled: true } }
    },
    getChatHistory: async () => ({
      ok: true,
      value: { messages: [...messages], canResume: messages.length > 0 }
    }),
    getChatState: async () => ({
      ok: true,
      value: {
        runningMessageId: running,
        tickRunning: scenario === 'tick-running',
        canResume: messages.length > 0
      }
    }),
    resetChat: async () =>
      running !== null
        ? { ok: false, code: 'conflict', message: '응답을 만드는 중에는 지울 수 없습니다.' }
        : ((messages = []), { ok: true, value: { cleared: true } }),
    getChatReferences: async () => ({
      ok: true,
      value: {
        decisions: [{ kind: 'decision', id: 'D-901', title: '(mock) 푸시 컨펌' }],
        briefings: [
          { kind: 'briefing', id: 'briefing-20260101090000', title: '(mock) 오전 브리핑' }
        ]
      }
    }),
    requestHrInstruction: async (req) => {
      const text = textOf(req, CHAT_MAX_HR_REQUEST_CHARS)
      if (text === null) return fail('인사 지시가 비었거나 너무 깁니다.')
      const id = String(hr.length + 1).padStart(3, '0')
      hr.push({ id, status: 'pending', excerpt: text.slice(0, 120) })
      return { ok: true, value: { id } }
    },
    // 조회할 때마다 한 단계씩 진행한 것처럼 보여 접수/진행/완료 표시를 확인할 수 있다.
    getHrInstructionStatuses: async () => {
      for (const r of hr) {
        const i = stages.indexOf(r.status as (typeof stages)[number])
        if (i >= 0 && i < stages.length - 1) r.status = stages[i + 1]
      }
      return {
        ok: true,
        value: {
          items: hr.map((r) => ({ ...r })).reverse(),
          pendingApprovals: hr.some((r) => r.status === 'done') ? 1 : 0
        }
      }
    },
    onChatEvent: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  }
}
