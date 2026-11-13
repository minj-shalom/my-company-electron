/** CEO와 COO 대화 창구(T-018) 계약. 대화 기록 원본은 앱 userData의 JSON이고 회사 폴더에는 쓰지 않는다. */

export const CHAT_MAX_MESSAGE_CHARS = 4000
export const CHAT_MAX_HR_REQUEST_CHARS = 2000
export const CHAT_MAX_HISTORY = 200

export type ChatRole = 'ceo' | 'coo'
export type ChatMessageStatus = 'ok' | 'failed' | 'cancelled'

/** COO 응답에서 가리키는 결정 카드와 브리핑. 제목은 신뢰하지 않는 텍스트다 (renderer가 sanitize). */
export interface ChatRef {
  kind: 'decision' | 'briefing'
  id: string
  title: string
}

export interface ChatMessage {
  id: string
  role: ChatRole
  text: string
  /** epoch ms */
  at: number
  status: ChatMessageStatus
  /** 이 응답을 만드는 동안 새로 생긴 결정 카드(`decision`)와 브리핑(`briefing`). */
  refs: ChatRef[]
}

export interface ChatHistory {
  messages: ChatMessage[]
  /** 이어갈 수 있는 세션이 있는지 (세션 id 값은 renderer에 주지 않는다). */
  canResume: boolean
}

export interface ChatSendRequest {
  text: string
}

export type ChatBlockedReason =
  | 'tick-running' // 자동 실행이 진행 중이다. 끝난 뒤 다시 보낸다.
  | 'chat-running' // 이미 응답을 만드는 중이다.
  | 'limit' // 사용량 한도 위험
  | 'unavailable' // 제공자를 쓸 수 없다

export type ChatSendResult =
  | { started: true; messageId: string; runId: string }
  | { started: false; reason: ChatBlockedReason; message: string }

export interface ChatState {
  /** 이 창구가 응답을 만드는 중이면 그 메시지 id. */
  runningMessageId: string | null
  tickRunning: boolean
  canResume: boolean
}

/** 스트리밍 이벤트. 도구 입력, 로그, stderr 같은 원문은 싣지 않는다. */
export type ChatEvent =
  | { type: 'started'; messageId: string; runId: string }
  | { type: 'text'; messageId: string; text: string }
  | { type: 'tool'; messageId: string; name: string }
  | { type: 'done'; message: ChatMessage }

export interface ChatHrRequestRequest {
  text: string
}

/** 인사 지시 접수. 요청 번호는 `company/hr-requests/<id>.md`의 파일 이름이다. */
export interface ChatHrRequestResult {
  id: string
}

/** 접수(pending) / 진행(running) / 완료(done) / 실패(failed). 승인 필요는 `pendingApprovals`로 따로 알린다. */
export type ChatHrStatus = 'pending' | 'running' | 'done' | 'failed'

export interface ChatHrRequestInfo {
  id: string
  status: ChatHrStatus
  /** 요청 본문 앞부분. */
  excerpt: string
}

export interface ChatHrStatusList {
  /** 최근 요청이 앞에 온다. */
  items: ChatHrRequestInfo[]
  /** 처리를 기다리는 인사 제안 결정 카드 수 (CEO 승인이 필요한 변경). */
  pendingApprovals: number
}

export interface ChatReferences {
  decisions: ChatRef[]
  briefings: ChatRef[]
}
