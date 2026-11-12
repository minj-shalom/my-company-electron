import { useId, useRef, useState } from 'react'
import type { Decision, DecisionResolveRequest } from '../../../shared/decision'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { KindBadge } from './KindBadge'
import { KIND_META, kindOf, MEMO_MAX, proposerLabel, sanitizeMemo } from './decision-view'

interface Props {
  decision: Decision
  expanded: boolean
  onToggle: () => void
  /** 실패하면 사용자용 문구를 돌려준다. 성공하면 null. */
  onResolve: (req: DecisionResolveRequest) => Promise<string | null>
}

/** 카드 한 장. 본문(question, 선택지, 메모)은 모두 React 텍스트 노드로만 그리고 줄바꿈은 CSS pre-wrap으로 보존한다. */
export function DecisionCard({
  decision: d,
  expanded,
  onToggle,
  onResolve
}: Props): React.JSX.Element {
  const bodyId = useId()
  const proposer = kindOf(d) === 'proposal' ? proposerLabel(d.proposedBy) : null
  const chosen = d.options.find((o) => o.key === d.chosen)
  return (
    <li className="dcard" data-status={d.status}>
      <button
        type="button"
        className="dcard__head"
        aria-expanded={expanded}
        aria-controls={bodyId}
        onClick={onToggle}
      >
        <span className="dcard__top">
          <KindBadge decision={d} />
          <span className="dcard__id">{d.id}</span>
          {d.ticketId && <span className="dcard__id">{d.ticketId}</span>}
        </span>
        <span className="dcard__title">{d.title}</span>
        {d.status === 'done' && (
          <span className="dcard__result">
            결과: {chosen ? `${chosen.key}. ${chosen.label}` : (d.chosen ?? '기록 없음')}
          </span>
        )}
      </button>
      <div id={bodyId} className="dcard__body" hidden={!expanded}>
        {expanded && (
          <>
            <p className="hint">{KIND_META[kindOf(d)].hint}</p>
            {proposer && (
              <p className="dcard__meta">
                제안자: <strong>{proposer}</strong>
              </p>
            )}
            <p className="dcard__text">{d.question}</p>
            {d.status === 'pending' ? (
              <ResolveForm decision={d} onResolve={onResolve} />
            ) : (
              <DoneDetail decision={d} />
            )}
          </>
        )}
      </div>
    </li>
  )
}

function OptionText({
  option,
  recommended
}: {
  option: Decision['options'][number]
  recommended: boolean
}): React.JSX.Element {
  return (
    <span className="dopt__text">
      <span className="dopt__label">
        {option.key}. {option.label}
        {recommended && <Badge tone="good">추천</Badge>}
      </span>
      {option.description && <span className="dcard__text">{option.description}</span>}
    </span>
  )
}

function DoneDetail({ decision: d }: { decision: Decision }): React.JSX.Element {
  return (
    <>
      <ul className="dopts" aria-label="선택지">
        {d.options.map((o) => (
          <li key={o.key} className="dopt" data-chosen={o.key === d.chosen}>
            <OptionText option={o} recommended={o.key === d.recommended} />
            {o.key === d.chosen && <Badge tone="info">선택됨</Badge>}
          </li>
        ))}
      </ul>
      <p className="dcard__meta">메모</p>
      <p className="dcard__text">{d.memo || '메모 없음'}</p>
    </>
  )
}

function ResolveForm({
  decision: d,
  onResolve
}: {
  decision: Decision
  onResolve: Props['onResolve']
}): React.JSX.Element {
  const [choice, setChoice] = useState<string | null>(null)
  const [memo, setMemo] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // state는 렌더 이후에 반영되므로 연타를 막으려면 ref가 필요하다.
  const guard = useRef(false)
  const groupId = useId()
  const memoId = useId()
  const picked = d.options.find((o) => o.key === choice)

  const confirm = async (): Promise<void> => {
    if (guard.current || !picked) return
    guard.current = true
    setBusy(true)
    setError(null)
    try {
      const failure = await onResolve({ id: d.id, choice: picked.key, memo: memo || undefined })
      if (failure) {
        setError(failure)
        setConfirming(false)
      }
    } finally {
      guard.current = false
      setBusy(false)
    }
  }

  if (d.options.length === 0) {
    return <p className="hint">선택지가 없는 카드예요. 카드 파일을 확인해 주세요.</p>
  }

  return (
    <form
      className="dform"
      onSubmit={(e) => {
        e.preventDefault()
        if (confirming) void confirm()
        else if (picked) setConfirming(true)
      }}
    >
      <fieldset className="dform__options" disabled={busy || confirming}>
        <legend id={groupId}>선택지</legend>
        {d.options.map((o) => (
          <label key={o.key} className="dopt dopt--pick" data-checked={choice === o.key}>
            <input
              type="radio"
              name={`${d.id}-choice`}
              value={o.key}
              checked={choice === o.key}
              onChange={() => setChoice(o.key)}
            />
            <OptionText option={o} recommended={o.key === d.recommended} />
          </label>
        ))}
      </fieldset>
      <div className="field">
        <label htmlFor={memoId}>메모 (선택, {MEMO_MAX}자 이하)</label>
        <Input
          id={memoId}
          extraClass="dform__memo"
          value={memo}
          maxLength={MEMO_MAX}
          disabled={busy || confirming}
          autoComplete="off"
          onChange={(e) => setMemo(sanitizeMemo(e.target.value))}
        />
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {confirming && picked ? (
        <div className="dform__confirm" role="group" aria-label="결정 확정">
          <p>
            <strong>
              {picked.key}. {picked.label}
            </strong>
            (으)로 확정할까요? 확정하면 처리됨으로 옮겨지고 되돌릴 수 없어요.
          </p>
          <div className="dform__actions">
            <Button variant="primary" type="submit" disabled={busy}>
              {busy ? '처리 중…' : '결정 확정'}
            </Button>
            <Button disabled={busy} onClick={() => setConfirming(false)}>
              돌아가기
            </Button>
          </div>
        </div>
      ) : (
        <div className="dform__actions">
          <Button variant="primary" type="submit" disabled={!picked}>
            선택 확인
          </Button>
        </div>
      )}
    </form>
  )
}
