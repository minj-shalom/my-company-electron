import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '../../../shared/chat'
import { ChatView } from './ChatView'
import {
  applyChatEvent,
  BLOCKED_TEXT,
  INITIAL_CHAT,
  isSendKey,
  parseMarkdown,
  validateDraft
} from './chat-model'
import { loadChatSnapshot, type UseChat } from './use-chat'

const msg = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'm1',
  role: 'coo',
  text: '안녕',
  at: 0,
  status: 'ok',
  refs: [],
  ...over
})

const base = (over: Partial<UseChat> = {}): UseChat => ({
  load: { kind: 'ready' },
  chat: INITIAL_CHAT,
  tickRunning: false,
  notice: null,
  hr: { items: [], pendingApprovals: 0 },
  refs: { decisions: [], briefings: [] },
  reload: () => {},
  send: async () => true,
  cancel: async () => {},
  reset: async () => {},
  ...over
})
const html = (over: Partial<UseChat> = {}): string =>
  renderToStaticMarkup(<ChatView {...base(over)} onOpenDecision={() => {}} />)

describe('ChatView states', () => {
  it('renders loading, error and empty', () => {
    expect(html({ load: { kind: 'loading' } })).toContain('불러오고 있어요')
    const err = html({ load: { kind: 'error', message: '실패' } })
    expect(err).toContain('role="alert"')
    expect(err).toContain('다시 시도')
    expect(html()).toContain('아직 대화가 없어요')
  })
  it('escapes message text and renders refs and failures', () => {
    const out = html({
      chat: {
        ...INITIAL_CHAT,
        canResume: true,
        messages: [
          msg({
            text: '<script>alert(1)</script> **굵게**',
            refs: [{ kind: 'decision', id: 'D-9', title: '<img src=x>' }]
          }),
          msg({ id: 'm2', status: 'failed' })
        ]
      }
    })
    expect(out).not.toContain('<script>')
    expect(out).not.toContain('<img')
    expect(out).toContain('<strong>굵게</strong>')
    expect(out).toContain('결재 요청 D-9')
    expect(out).toContain('답을 만들지 못함')
    expect(out).toContain('이어서 할 수 있어요')
  })
  it('locks sending during ticks and shows streaming with cancel', () => {
    const locked = html({ tickRunning: true })
    expect(locked).toContain('자동 실행이 진행 중')
    expect(locked).toMatch(/<button[^>]*disabled=""[^>]*>보내기/)
    const s = html({ chat: { ...INITIAL_CHAT, runningId: 'x', streaming: '정리 중' } })
    expect(s).toContain('답하는 중')
    expect(s).toContain('정리 중')
    expect(s).toContain('답변 취소')
  })
  it('shows hr statuses and pending approvals', () => {
    const out = html({
      hr: {
        items: [
          { id: '001', status: 'running', excerpt: 'pm 채용' },
          { id: '002', status: 'failed', excerpt: 'x' }
        ],
        pendingApprovals: 2
      }
    })
    expect(out).toContain('진행 중')
    expect(out).toContain('실패')
    expect(out).toContain('승인이 필요한 인사 변경 2건')
  })
})

describe('chat model', () => {
  it('applies stream events and ignores stale ones', () => {
    let s = applyChatEvent(INITIAL_CHAT, { type: 'started', messageId: 'a', runId: 'r' })
    s = applyChatEvent(s, { type: 'text', messageId: 'a', text: '가' })
    s = applyChatEvent(s, { type: 'text', messageId: 'zzz', text: '무시' })
    s = applyChatEvent(s, { type: 'tool', messageId: 'a', name: 'Read' })
    expect(s.streaming).toBe('가')
    expect(s.tool).toBe('Read')
    s = applyChatEvent(s, { type: 'done', message: msg({ id: 'a' }) })
    expect(s.runningId).toBeNull()
    expect(s.messages).toHaveLength(1)
    expect(s.canResume).toBe(true)
  })
  it('has text for every blocked reason', () => {
    for (const r of ['tick-running', 'chat-running', 'limit', 'unavailable'] as const)
      expect(BLOCKED_TEXT[r]).not.toBe('')
  })
  it('validates drafts and send key', () => {
    expect(validateDraft('  ', 'message')).not.toBeNull()
    expect(validateDraft('a'.repeat(2001), 'hr')).not.toBeNull()
    expect(validateDraft('a'.repeat(2001), 'message')).toBeNull()
    expect(isSendKey({ key: 'Enter', shiftKey: false })).toBe(true)
    expect(isSendKey({ key: 'Enter', shiftKey: true })).toBe(false)
    expect(isSendKey({ key: 'Enter', shiftKey: false, isComposing: true })).toBe(false)
  })
  it('parses markdown without html', () => {
    const b = parseMarkdown('문단 `코드`\n\n- 하나\n- 둘\n\n```\n<b>x</b>\n```')
    expect(b.map((x) => x.kind)).toEqual(['p', 'ul', 'pre'])
  })
})

describe('literal output and failures', () => {
  it('prints html and javascript links as plain text', () => {
    const out = html({
      chat: {
        ...INITIAL_CHAT,
        messages: [msg({ text: '<img src=x onerror=alert(1)> [x](javascript:alert(1))' })]
      }
    })
    expect(out).not.toContain('<img')
    expect(out).not.toContain('<a ')
    expect(out).not.toContain('href=')
    expect(out).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(out).toContain('[x](javascript:alert(1))')
  })
  it('shows a hint while the coo is answering without a tick lock', () => {
    const out = html({ chat: { ...INITIAL_CHAT, runningId: 'x' } })
    expect(out).toContain('COO가 답하는 중이에요')
  })
  it('turns IPC rejection or failure into null', async () => {
    const boom = async (): Promise<never> => {
      throw new Error('ipc')
    }
    expect(await loadChatSnapshot({ getChatHistory: boom, getChatState: boom })).toBeNull()
    expect(
      await loadChatSnapshot({
        getChatHistory: async () => ({ ok: false, code: 'internal', message: 'x' }),
        getChatState: boom
      })
    ).toBeNull()
  })
})
