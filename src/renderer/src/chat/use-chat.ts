import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatHrStatusList, ChatReferences } from '../../../shared/chat'
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

const NO_HR: ChatHrStatusList = { items: [], pendingApprovals: 0 }
const NO_REFS: ChatReferences = { decisions: [], briefings: [] }

/** 대화 기록, 스트리밍 이벤트, 자동 실행 잠금, 인사 지시 상태를 한 곳에서 관리한다. */
export function useChat(): UseChat {
  const [load, setLoad] = useState<ChatLoad>({ kind: 'loading' })
  const [chat, setChat] = useState<ChatState>(INITIAL_CHAT)
  const [tickRunning, setTickRunning] = useState(false)
  const [notice, setNotice] = useState<UseChat['notice']>(null)
  const [hr, setHr] = useState<ChatHrStatusList>(NO_HR)
  const [refs, setRefs] = useState<ChatReferences>(NO_REFS)
  const alive = useRef(true)
  const counter = useRef(0)

  const readHr = useCallback(async (): Promise<void> => {
    const r = await window.api.getHrInstructionStatuses()
    if (alive.current && r.ok) setHr(r.value)
  }, [])

  const readRefs = useCallback(async (): Promise<void> => {
    const r = await window.api.getChatReferences()
    if (alive.current && r.ok) setRefs(r.value)
  }, [])

  const readState = useCallback(async (): Promise<void> => {
    const r = await window.api.getChatState()
    if (!alive.current || !r.ok) return
    setTickRunning(r.value.tickRunning)
    // 응답 중 이벤트를 놓쳤을 때(다른 창, 재시작) 실행 중 표시를 서버 값에 맞춘다.
    setChat((s) =>
      s.runningId === r.value.runningMessageId ? s : { ...s, runningId: r.value.runningMessageId }
    )
  }, [])

  const fetchAll = useCallback(async (): Promise<void> => {
    {
      const [h, st] = await Promise.all([window.api.getChatHistory(), window.api.getChatState()])
      if (!alive.current) return
      if (!h.ok) {
        setLoad({ kind: 'error', message: '대화 기록을 불러오지 못했어요.' })
        return
      }
      setChat((s) => ({
        ...s,
        messages: h.value.messages,
        canResume: h.value.canResume,
        runningId: st.ok ? st.value.runningMessageId : null
      }))
      if (st.ok) setTickRunning(st.value.tickRunning)
      setLoad({ kind: 'ready' })
      await Promise.all([readHr(), readRefs()])
    }
  }, [readHr, readRefs])

  const reload = useCallback((): void => {
    setLoad({ kind: 'loading' })
    void fetchAll()
  }, [fetchAll])

  useEffect(() => {
    alive.current = true
    void Promise.resolve().then(fetchAll)
    const off = window.api.onChatEvent((e) => setChat((s) => applyChatEvent(s, e)))
    const timer = setInterval(() => {
      void readState()
      void readHr()
      void readRefs()
    }, POLL_MS)
    return () => {
      alive.current = false
      off()
      clearInterval(timer)
    }
  }, [fetchAll, readState, readHr, readRefs])

  const send = useCallback(
    async (text: string, mode: ChatMode): Promise<boolean> => {
      setNotice(null)
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

  const cancel = useCallback(async (): Promise<void> => {
    const r = await window.api.cancelChat()
    if (!r.ok) setNotice({ tone: 'bad', text: '취소하지 못했어요.' })
  }, [])

  const reset = useCallback(async (): Promise<void> => {
    const r = await window.api.resetChat()
    if (!r.ok) {
      setNotice({ tone: 'warn', text: '응답을 만드는 중에는 새 대화를 시작할 수 없어요.' })
      return
    }
    setNotice(null)
    setChat({ ...INITIAL_CHAT })
  }, [])

  return { load, chat, tickRunning, notice, hr, refs, reload, send, cancel, reset }
}
