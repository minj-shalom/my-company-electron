import { CHAT_MAX_HR_REQUEST_CHARS, CHAT_MAX_MESSAGE_CHARS } from '../../shared/chat'

/** 제어 문자(탭·줄바꿈 제외)와 NUL은 프롬프트·파일에 넣지 않는다. */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u0085\u2028\u2029]/g

function textField(req: unknown, max: number): string | null {
  if (typeof req !== 'object' || req === null) return null
  const text = (req as Record<string, unknown>)['text']
  if (typeof text !== 'string' || text.length > max * 2) return null
  const clean = text.replace(/\r\n?/g, '\n').replace(CONTROL, '').trim()
  return clean === '' || clean.length > max ? null : clean
}

export const validateChatMessage = (req: unknown): string | null =>
  textField(req, CHAT_MAX_MESSAGE_CHARS)

export const validateHrRequestText = (req: unknown): string | null =>
  textField(req, CHAT_MAX_HR_REQUEST_CHARS)
