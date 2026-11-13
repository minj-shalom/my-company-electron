import { useCallback, useEffect, useRef, useState } from 'react'
import type { WindowApi } from '../../../shared/api'
import type { ChatHrStatusList, ChatMessage, ChatReferences } from '../../../shared/chat'
import {
  applyChatEvent,
  BLOCKED_TEXT,
  INITIAL_CHAT,
  type ChatMode,
  type ChatState
} from './chat-model'

export type ChatLoad = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready' }

const POLL_MS = 4000

export interface UseChat {
  load: ChatLoad
  chat: ChatState
  tickRunning: boolean
  /** 보내기 결과나 오류를 알리는 한 줄. */
  notice: { tone: 'ok' | 'warn' | 'bad'; text: string } | null
  hr: ChatHrStatusList
  /** 지금 기다리는 결정 카드와 최근 브리핑. 못 읽으면 빈 목록. */
  refs: ChatReferences
  reload: () => void
  send: (text: string, mode: ChatMode) => Promise<boolean>
  cancel: () => Promise<void>
  reset: () => Promise<void>
}

export interface ChatSnapshot {
  messages: ChatMessage[]
  canResume: boolean
  runningId: string | null
  /** 상태 조회가 실패하면 null (기존 값 유지). */
  tickRunning: boolean | null
}

/** 처음 불러오기. 기록 조회가 실패하거나 IPC가 예외를 던지면 null. */
export async function loadChatSnapshot(
  api: Pick<WindowApi, 'getChatHistory' | 'getChatState'>
): Promise<ChatSnapshot | null> {
  try {
    const [h, st] = await Promise.all([api.getChatHistory(), api.getChatState()])
    if (!h.ok) return null
    return {
      messages: h.value.messages,
      canResume: h.value.canResume,
      runningId: st.ok ? st.value.runningMessageId : null,
      tickRunning: st.ok ? st.value.tickRunning : null
    }
  } catch {
    return null
  }
}

const NO_HR: ChatHrStatusList = { items: [], pendingApprovals: 0 }
const NO_REFS: ChatReferences = { decisions: [], briefings: [] }

/** 대화 기록, 스트리밍 이벤트, 자동 실행 잠금, 인사 지시 상태를 한 곳에서 관리한다. */
/** active: 대화 화면이 보일 때만 주기적으로 다시 읽는다. */
export function useChat(active = true): UseChat {
  const [load, setLoad] = useState<ChatLoad>({ kind: 'loading' })
  const [chat, setChat] = useState<ChatState>(INITIAL_CHAT)
  const [tickRunning, setTickRunning] = useState(false)
  const [notice, setNotice] = useState<UseChat['notice']>(null)
  const [hr, setHr] = useState<ChatHrStatusList>(NO_HR)
  const [refs, setRefs] = useState<ChatReferences>(NO_REFS)
  const alive = useRef(true)
  const counter = useRef(0)

  const readHr = useCallback(async (): Promise<void> => {
    try {
      const r = await window.api.getHrInstructionStatuses()
      if (alive.current && r.ok) setHr(r.value)
    } catch {
      // 폴링 실패는 다음 주기에 다시 시도한다.
    }
  }, [])

  const readRefs = useCallback(async (): Promise<void> => {
    try {
      const r = await window.api.getChatReferences()
      if (alive.current && r.ok) setRefs(r.value)
    } catch {
      // 폴링 실패는 다음 주기에 다시 시도한다.
    }
  }, [])

  const readState = useCallback(async (): Promise<void> => {
    try {
      const r = await window.api.getChatState()
      if (!alive.current || !r.ok) return
      setTickRunning(r.value.tickRunning)
      // 응답 중 이벤트를 놓쳤을 때(다른 창, 재시작) 실행 중 표시를 서버 값에 맞춘다.
      setChat((s) =>
        s.runningId === r.value.runningMessageId ? s : { ...s, runningId: r.value.runningMessageId }
      )
    } catch {
      // 폴링 실패는 무시한다.
    }
  }, [])

  const fetchAll = useCallback(async (): Promise<void> => {
    const snap = await loadChatSnapshot(window.api)
    if (!alive.current) return
    if (!snap) {
      setLoad({ kind: 'error', message: '대화 기록을 불러오지 못했어요.' })
      return
    }
    setChat((s) => ({
      ...s,
      messages: snap.messages,
      canResume: snap.canResume,
      runningId: snap.runningId
    }))
    if (snap.tickRunning !== null) setTickRunning(snap.tickRunning)
    setLoad({ kind: 'ready' })
    await Promise.all([readHr(), readRefs()])
  }, [readHr, readRefs])

  const reload = useCallback((): void => {
    setLoad({ kind: 'loading' })
    void fetchAll()
  }, [fetchAll])

  useEffect(() => {
    alive.current = true
    void Promise.resolve().then(fetchAll)
    const off = window.api.onChatEvent((e) => setChat((s) => applyChatEvent(s, e)))
    return () => {
      alive.current = false
      off()
    }
  }, [fetchAll])

  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => {
      void readState()
      void readHr()
      void readRefs()
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [active, readState, readHr, readRefs])

  const sendInner = useCallback(
    async (text: string, mode: ChatMode): Promise<boolean> => {
      if (mode === 'hr') {
        const r = await window.api.requestHrInstruction({ text })
        if (!r.ok) {
          setNotice({
            tone: 'bad',
            text: '인사 지시를 접수하지 못했어요. 잠시 뒤 다시 시도해 주세요.'
          })
          return false
        }
        setNotice({ tone: 'ok', text: `인사 지시를 접수했어요 (요청 ${r.value.id}).` })
        await readHr()
        return true
      }
      const r = await window.api.sendChat({ text })
      if (!r.ok) {
        setNotice({ tone: 'bad', text: '메시지를 보내지 못했어요. 잠시 뒤 다시 시도해 주세요.' })
        return false
      }
      if (!r.value.started) {
        setNotice({ tone: 'warn', text: BLOCKED_TEXT[r.value.reason] })
        if (r.value.reason === 'tick-running') setTickRunning(true)
        return false
      }
      const { messageId } = r.value
      counter.current += 1
      setChat((s) => ({
        ...s,
        messages: [
          ...s.messages,
          {
            id: `local-${counter.current}`,
            role: 'ceo',
            text,
            at: Date.now(),
            status: 'ok',
            refs: []
          }
        ],
        // started 이벤트가 먼저 와 있을 수 있어 이미 시작한 상태는 지우지 않는다.
        runningId: s.runningId ?? messageId
      }))
      return true
    },
    [readHr]
  )

  // IPC가 예외로 실패해도 화면이 멈추지 않고 안내만 띄운다.
  const send = useCallback(
    async (text: string, mode: ChatMode): Promise<boolean> => {
      setNotice(null)
      try {
        return await sendInner(text, mode)
      } catch {
        setNotice({ tone: 'bad', text: '요청을 보내지 못했어요. 잠시 뒤 다시 시도해 주세요.' })
        return false
      }
    },
    [sendInner]
  )

  const cancel = useCallback(async (): Promise<void> => {
    try {
      const r = await window.api.cancelChat()
      if (!r.ok) setNotice({ tone: 'bad', text: '취소하지 못했어요.' })
    } catch {
      setNotice({ tone: 'bad', text: '취소하지 못했어요.' })
    }
  }, [])

  const reset = useCallback(async (): Promise<void> => {
    try {
      const r = await window.api.resetChat()
      if (!r.ok) {
        setNotice({ tone: 'warn', text: '응답을 만드는 중에는 새 대화를 시작할 수 없어요.' })
        return
      }
      setNotice(null)
      setChat({ ...INITIAL_CHAT })
    } catch {
      setNotice({ tone: 'bad', text: '새 대화를 시작하지 못했어요.' })
    }
  }, [])

  return { load, chat, tickRunning, notice, hr, refs, reload, send, cancel, reset }
}
