import {
  CHAT_MAX_HR_REQUEST_CHARS,
  CHAT_MAX_MESSAGE_CHARS,
  type ChatBlockedReason,
  type ChatEvent,
  type ChatHrStatus,
  type ChatMessage
} from '../../../shared/chat'

export type ChatMode = 'message' | 'hr'

export interface ChatState {
  messages: ChatMessage[]
  canResume: boolean
  /** 응답을 만드는 중인 메시지 id. */
  runningId: string | null
  /** 스트리밍 중인 응답 본문(아직 확정 전). */
  streaming: string
  /** 응답 중 쓰고 있는 도구 이름 (표시용). */
  tool: string | null
}

export const INITIAL_CHAT: ChatState = {
  messages: [],
  canResume: false,
  runningId: null,
  streaming: '',
  tool: null
}

/** 스트리밍 이벤트를 상태에 반영한다. 다른 메시지의 늦은 이벤트는 무시한다. */
export function applyChatEvent(s: ChatState, e: ChatEvent): ChatState {
  switch (e.type) {
    case 'started':
      return { ...s, runningId: e.messageId, streaming: '', tool: null }
    case 'text':
      if (s.runningId !== e.messageId) return s
      return { ...s, streaming: s.streaming === '' ? e.text : `${s.streaming}${e.text}` }
    case 'tool':
      return s.runningId === e.messageId ? { ...s, tool: e.name } : s
    case 'done': {
      const rest = s.messages.filter((m) => m.id !== e.message.id)
      return {
        ...s,
        messages: [...rest, e.message],
        canResume: true,
        runningId: s.runningId === e.message.id ? null : s.runningId,
        streaming: s.runningId === e.message.id ? '' : s.streaming,
        tool: s.runningId === e.message.id ? null : s.tool
      }
    }
  }
}

export const BLOCKED_TEXT: Record<ChatBlockedReason, string> = {
  'tick-running': '지금 자동 실행이 진행 중이라 메시지를 보낼 수 없어요. 끝나면 다시 보내 주세요.',
  'chat-running': '이미 COO가 답을 만드는 중이에요. 끝난 뒤 보내 주세요.',
  limit: '사용량 한도에 가까워서 지금은 대화를 시작하지 않았어요. 설정·예산에서 확인해 주세요.',
  unavailable: '지금은 AI 도구를 사용할 수 없어요. 연결 상태를 확인한 뒤 다시 시도해 주세요.'
}

export const HR_STATUS_META: Record<
  ChatHrStatus,
  { label: string; tone: 'info' | 'warn' | 'good' | 'bad' }
> = {
  pending: { label: '접수됨', tone: 'info' },
  running: { label: '진행 중', tone: 'warn' },
  done: { label: '완료', tone: 'good' },
  failed: { label: '실패', tone: 'bad' }
}

export function maxChars(mode: ChatMode): number {
  return mode === 'hr' ? CHAT_MAX_HR_REQUEST_CHARS : CHAT_MAX_MESSAGE_CHARS
}

/** 보낼 수 있는 입력인지 (공백만 있거나 길이 초과면 아니다). */
export function validateDraft(text: string, mode: ChatMode): string | null {
  if (text.trim() === '') return '내용을 입력해 주세요.'
  if (text.length > maxChars(mode)) return `${maxChars(mode)}자 이하로 줄여 주세요.`
  return null
}

/** Enter만 누르면 전송, Shift+Enter는 줄바꿈. 한글 조합 중 Enter는 전송하지 않는다. */
export function isSendKey(e: { key: string; shiftKey: boolean; isComposing?: boolean }): boolean {
  return e.key === 'Enter' && !e.shiftKey && e.isComposing !== true
}

export function formatTime(at: number): string {
  const d = new Date(at)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

export type Inline = { kind: 'text' | 'bold' | 'code'; text: string }
export type Block =
  | { kind: 'p'; inlines: Inline[] }
  | { kind: 'ul'; items: Inline[][] }
  | { kind: 'pre'; text: string }

export function parseInline(line: string): Inline[] {
  const out: Inline[] = []
  const re = /\*\*([^*]+)\*\*|`([^`]+)`/g
  let last = 0
  for (let m = re.exec(line); m; m = re.exec(line)) {
    if (m.index > last) out.push({ kind: 'text', text: line.slice(last, m.index) })
    out.push(m[1] !== undefined ? { kind: 'bold', text: m[1] } : { kind: 'code', text: m[2] })
    last = m.index + m[0].length
  }
  if (last < line.length) out.push({ kind: 'text', text: line.slice(last) })
  return out
}

/**
 * 안전한 최소 마크다운(문단, 목록, 코드 블록, 굵게, 인라인 코드). HTML을 만들지 않고 React 요소로만 그리므로
 * 링크·이미지·원시 HTML은 지원하지 않고 글자 그대로 보인다.
 */
export function parseMarkdown(src: string): Block[] {
  const blocks: Block[] = []
  const lines = src.split('\n')
  let para: string[] = []
  let list: Inline[][] = []
  const flush = (): void => {
    if (para.length) blocks.push({ kind: 'p', inlines: parseInline(para.join('\n')) })
    if (list.length) blocks.push({ kind: 'ul', items: list })
    para = []
    list = []
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.startsWith('```')) {
      flush()
      const code: string[] = []
      for (i++; i < lines.length && !lines[i].startsWith('```'); i++) code.push(lines[i])
      blocks.push({ kind: 'pre', text: code.join('\n') })
    } else if (/^\s*[-*] /.test(line)) {
      if (para.length) flush()
      list.push(parseInline(line.replace(/^\s*[-*] /, '')))
    } else if (line.trim() === '') flush()
    else {
      if (list.length) flush()
      para.push(line)
    }
  }
  flush()
  return blocks
}
