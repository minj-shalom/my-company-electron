import { useEffect, useId, useRef, useState } from 'react'
import type { Decision, DecisionResolveRequest } from '../../../shared/decision'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { DraftPreview } from '../publication/DraftPreview'
import { parseApprovalCard } from '../publication/publication-model'
import { KindBadge } from './KindBadge'
import { QuarantineList, QuestionBody } from './ProposalPanel'
import { isApprovable, splitQuestion, usesApplyApi } from './proposal-view'
import {
  focusAfterTransition,
  KIND_META,
  kindOf,
  MEMO_MAX,
  proposerLabel,
  resolveErrorText,
  runExclusive,
  sanitizeMemo
} from './decision-view'

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
            <CardText decision={d} />
            <ApprovalDrafts decision={d} />
            <QuarantineList decision={d} />
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

/** 제안 카드는 `proposal` 블록을 변경 목록으로 풀어 보여 주고, 나머지는 텍스트 그대로. */
function CardText({ decision: d }: { decision: Decision }): React.JSX.Element {
  if (kindOf(d) !== 'proposal') return <p className="dcard__text">{d.question}</p>
  return <QuestionBody segments={splitQuestion(d.question)} />
}

/** 콘텐츠 승인 카드에서 초안 본문을 평문으로 미리 본다. 카드 본문 형식이 다르면 아무것도 보이지 않는다. */
function ApprovalDrafts({ decision: d }: { decision: Decision }): React.JSX.Element | null {
  if (kindOf(d) !== 'content-approval') return null
  const parsed = parseApprovalCard(d.question)
  if (!parsed) return null
  return (
    <div className="dcard__drafts">
      {parsed.paths.map((path) => (
        <DraftPreview key={path} projectId={parsed.projectId} path={path} />
      ))}
    </div>
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
  const apply = usesApplyApi(kindOf(d))
  // 승인 선택지는 파싱된 변경이 있을 때만 열린다 (알 수 없는 액션이 든 카드는 거절만 가능).
  const approvable = kindOf(d) !== 'proposal' || isApprovable(splitQuestion(d.question))
  // 콘텐츠 승인을 거절하면 직원이 고칠 수 있게 사유를 꼭 적게 한다.
  const rejecting = kindOf(d) === 'content-approval' && picked?.label === '거절'
  const needsReason = rejecting && memo.trim() === ''
  const locked = (o: Decision['options'][number]): boolean => !approvable && o.label === '승인'

  const mounted = useRef(true)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const checkRef = useRef<HTMLButtonElement>(null)
  // 버튼으로 단계가 바뀐 경우에만 값이 채워지고 effect가 소비한다 (입력 중 포커스를 뺏지 않기 위해).
  const focusTarget = useRef<'confirm' | 'check' | null>(null)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  useEffect(() => {
    const target = focusTarget.current
    focusTarget.current = null
    if (target === 'confirm') confirmRef.current?.focus()
    else if (target === 'check') checkRef.current?.focus()
  }, [confirming])

  const setStep = (open: boolean, t: Parameters<typeof focusAfterTransition>[0]): void => {
    focusTarget.current = focusAfterTransition(t)
    setConfirming(open)
  }

  const confirm = async (): Promise<void> => {
    if (!picked) return
    setBusy(true)
    setError(null)
    const r = await runExclusive(guard, async () => {
      try {
        return await onResolve({ id: d.id, choice: picked.key, memo: memo || undefined })
      } catch {
        return resolveErrorText('unknown')
      }
    })
    // 성공하면 카드가 목록에서 사라져 언마운트되므로 그때는 상태를 건드리지 않는다.
    if (!r.ran || !mounted.current) return
    setBusy(false)
    if (r.value) {
      setError(r.value)
      setStep(false, 'failure')
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
        if (confirming) {
          if (!busy) void confirm()
        } else if (picked && !needsReason) setStep(true, 'open')
      }}
    >
      <fieldset className="dform__options">
        <legend id={groupId}>선택지</legend>
        {d.options.map((o) => (
          <label key={o.key} className="dopt dopt--pick" data-checked={choice === o.key}>
            <input
              type="radio"
              name={`${d.id}-choice`}
              value={o.key}
              disabled={locked(o)}
              checked={choice === o.key}
              onChange={() => {
                if (busy) return
                setChoice(o.key)
                setStep(false, 'edit')
              }}
            />
            <OptionText option={o} recommended={o.key === d.recommended} />
          </label>
        ))}
      </fieldset>
      {apply ? null : (
        <div className="field">
          <label htmlFor={memoId}>
            {rejecting ? `거절 사유 (필수, ${MEMO_MAX}자 이하)` : `메모 (선택, ${MEMO_MAX}자 이하)`}
          </label>
          <Input
            id={memoId}
            extraClass="dform__memo"
            value={memo}
            maxLength={MEMO_MAX}
            readOnly={busy}
            autoComplete="off"
            onChange={(e) => {
              setMemo(sanitizeMemo(e.target.value))
              setStep(false, 'edit')
            }}
          />
        </div>
      )}
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
            (으)로 확정할까요?{' '}
            {apply
              ? '앱이 바로 처리하고 카드를 처리됨으로 옮겨요. 승인하면 직원 파일·조직도가 바뀔 수 있어요.'
              : '확정하면 처리됨으로 옮겨지고 되돌릴 수 없어요.'}
          </p>
          <div className="dform__actions">
            <Button ref={confirmRef} variant="primary" type="submit" aria-disabled={busy}>
              {busy ? '처리 중…' : '결정 확정'}
            </Button>
            <Button aria-disabled={busy} onClick={() => !busy && setStep(false, 'back')}>
              돌아가기
            </Button>
          </div>
        </div>
      ) : (
        <div className="dform__actions">
          <Button ref={checkRef} variant="primary" type="submit" disabled={!picked || needsReason}>
            선택 확인
          </Button>
        </div>
      )}
    </form>
  )
}
