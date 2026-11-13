import { useEffect, useId, useRef, useState } from 'react'
import type { ChatMessage, ChatRef } from '../../../shared/chat'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { ChatMarkdown } from './ChatMarkdown'
import {
  formatTime,
  HR_STATUS_META,
  isSendKey,
  maxChars,
  validateDraft,
  type ChatMode
} from './chat-model'
import type { UseChat } from './use-chat'

interface Props extends UseChat {
  /** 결정 카드 링크를 누르면 결재함을 연다. */
  onOpenDecision: () => void
}

function Refs({
  refs,
  onOpenDecision
}: {
  refs: ChatRef[]
  onOpenDecision: () => void
}): React.JSX.Element | null {
  if (refs.length === 0) return null
  return (
    <ul className="chat-refs" aria-label="관련 항목">
      {refs.map((r) => (
        <li key={`${r.kind}-${r.id}`}>
          {r.kind === 'decision' ? (
            <Button size="small" onClick={onOpenDecision} aria-label={`결재함에서 ${r.id} 보기`}>
              결재 요청 {r.id}: {r.title}
            </Button>
          ) : (
            <span className="chat-ref-note">브리핑 {r.title} (보고서 폴더에 저장됨)</span>
          )}
        </li>
      ))}
    </ul>
  )
}

function Bubble({
  m,
  onOpenDecision
}: {
  m: ChatMessage
  onOpenDecision: () => void
}): React.JSX.Element {
  const who = m.role === 'ceo' ? '나(CEO)' : 'COO'
  return (
    <li className="chat-msg" data-role={m.role} data-status={m.status}>
      <div className="chat-msg__head">
        <strong>{who}</strong>
        <time>{formatTime(m.at)}</time>
        {m.status === 'failed' && <Badge tone="bad">답을 만들지 못함</Badge>}
        {m.status === 'cancelled' && <Badge tone="neutral">취소됨</Badge>}
      </div>
      {m.role === 'coo' ? <ChatMarkdown text={m.text} /> : <p className="chat-plain">{m.text}</p>}
      <Refs refs={m.refs} onOpenDecision={onOpenDecision} />
    </li>
  )
}

/** CEO와 COO의 대화 화면. 상태: 불러오는 중 / 오류 / 비어 있음 / 대화 중. */
export function ChatView(props: Props): React.JSX.Element {
  const { load, chat, tickRunning, notice, hr, refs, onOpenDecision } = props
  const [mode, setMode] = useState<ChatMode>('message')
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inputId = useId()
  const logEnd = useRef<HTMLDivElement>(null)
  const running = chat.runningId !== null
  const locked = mode === 'message' && (running || tickRunning)

  useEffect(() => {
    logEnd.current?.scrollIntoView?.({ block: 'end' })
  }, [chat.messages.length, chat.streaming])

  const submit = async (): Promise<void> => {
    const err = validateDraft(draft, mode)
    if (err) return setError(err)
    if (locked || busy) return
    setError(null)
    setBusy(true)
    const ok = await props.send(draft, mode)
    setBusy(false)
    if (ok) setDraft('')
  }

  const newChat = (): void => {
    if (chat.messages.length > 0 && !window.confirm('지금 대화를 지우고 새로 시작할까요?')) return
    void props.reset()
  }

  if (load.kind === 'loading')
    return (
      <section className="chat" aria-labelledby="chat-heading" aria-busy="true">
        <h2 id="chat-heading" tabIndex={-1}>
          COO와 대화
        </h2>
        <p role="status">대화를 불러오고 있어요…</p>
      </section>
    )
  if (load.kind === 'error')
    return (
      <section className="chat" aria-labelledby="chat-heading">
        <h2 id="chat-heading" tabIndex={-1}>
          COO와 대화
        </h2>
        <p role="alert">{load.message}</p>
        <Button onClick={props.reload}>다시 시도</Button>
      </section>
    )

  const pendingRefs = [...refs.decisions, ...refs.briefings]
  return (
    <section className="chat" aria-labelledby="chat-heading">
      <div className="chat__top">
        <h2 id="chat-heading" tabIndex={-1}>
          COO와 대화
        </h2>
        <Button size="small" onClick={newChat} disabled={running}>
          새 대화
        </Button>
      </div>
      {chat.canResume && chat.messages.length > 0 && (
        <p className="chat__hint">
          이전 대화를 이어서 할 수 있어요. 새로 시작하려면 &quot;새 대화&quot;를 누르세요.
        </p>
      )}
      {tickRunning && (
        <p className="chat__lock" role="status">
          지금 자동 실행이 진행 중이에요. 끝날 때까지 COO에게 메시지를 보낼 수 없어요. (인사 지시는
          접수할 수 있어요)
        </p>
      )}
      {pendingRefs.length > 0 && (
        <details className="chat__refs">
          <summary>기다리는 결재와 브리핑 {pendingRefs.length}건</summary>
          <Refs refs={pendingRefs} onOpenDecision={onOpenDecision} />
        </details>
      )}
      <div className="chat__log" role="log" aria-live="polite" aria-label="대화 내용" tabIndex={0}>
        {chat.messages.length === 0 && !running ? (
          <p className="chat__empty">아직 대화가 없어요. COO에게 지시나 질문을 남겨 보세요.</p>
        ) : (
          <ul className="chat__list">
            {chat.messages.map((m) => (
              <Bubble key={m.id} m={m} onOpenDecision={onOpenDecision} />
            ))}
            {running && (
              <li className="chat-msg" data-role="coo" data-streaming="true">
                <div className="chat-msg__head">
                  <strong>COO</strong>
                  <Badge tone="warn">답하는 중</Badge>
                  {chat.tool && <span className="chat-ref-note">{chat.tool} 사용 중</span>}
                </div>
                {chat.streaming !== '' && <ChatMarkdown text={chat.streaming} />}
              </li>
            )}
          </ul>
        )}
        <div ref={logEnd} />
      </div>
      {hr.items.length > 0 && (
        <section className="chat__hr" aria-label="인사 지시 처리 상태">
          <h3>인사 지시</h3>
          {hr.pendingApprovals > 0 && (
            <p className="chat__lock" role="status">
              승인이 필요한 인사 변경 {hr.pendingApprovals}건이 결재함에서 기다리고 있어요.{' '}
              <Button size="small" onClick={onOpenDecision}>
                결재함 열기
              </Button>
            </p>
          )}
          <ul>
            {hr.items.slice(0, 5).map((it) => {
              const meta = HR_STATUS_META[it.status]
              return (
                <li key={it.id}>
                  <Badge tone={meta.tone}>{meta.label}</Badge> <span>{it.excerpt}</span>
                </li>
              )
            })}
          </ul>
        </section>
      )}
      <form
        className="chat__form"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <div role="radiogroup" aria-label="보내는 방식" className="chat__modes">
          {(['message', 'hr'] as const).map((m) => (
            <label key={m}>
              <input
                type="radio"
                name="chat-mode"
                checked={mode === m}
                onChange={() => setMode(m)}
              />
              {m === 'message' ? '일반 메시지' : '인사 지시'}
            </label>
          ))}
        </div>
        <label htmlFor={inputId} className="chat__label">
          {mode === 'hr' ? '인사 지시 (예: pm 채용해)' : 'COO에게 보낼 메시지'}
        </label>
        <textarea
          id={inputId}
          value={draft}
          rows={3}
          maxLength={maxChars(mode)}
          aria-invalid={error !== null}
          aria-describedby={error ? `${inputId}-err` : undefined}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (
              isSendKey({
                key: e.key,
                shiftKey: e.shiftKey,
                isComposing: e.nativeEvent.isComposing
              })
            ) {
              e.preventDefault()
              void submit()
            }
          }}
          placeholder="Enter로 보내기, Shift+Enter로 줄바꿈"
        />
        {error && (
          <p id={`${inputId}-err`} role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p role={notice.tone === 'bad' ? 'alert' : 'status'} data-tone={notice.tone}>
            {notice.text}
          </p>
        )}
        <div className="chat__actions">
          <Button type="submit" variant="primary" disabled={locked || busy}>
            {mode === 'hr' ? '지시 접수' : '보내기'}
          </Button>
          {running && <Button onClick={() => void props.cancel()}>답변 취소</Button>}
        </div>
      </form>
    </section>
  )
}
