import type { Decision } from '../../../shared/decision'
import { Badge } from '../ui/Badge'
import {
  actionView,
  blockFailureText,
  quarantinedEmployees,
  type QuestionSegment
} from './proposal-view'

/** 카드 본문은 신뢰할 수 없는 텍스트다. 모든 값은 React 텍스트 노드로만 그린다. */
export function QuestionBody({
  segments
}: {
  segments: readonly QuestionSegment[]
}): React.JSX.Element {
  return (
    <>
      {segments.map((s, i) => {
        if (s.type === 'text')
          return (
            <p key={i} className="dcard__text">
              {s.text}
            </p>
          )
        if (s.type === 'invalid')
          return (
            <p key={i} role="alert" className="error">
              {blockFailureText(s.reason)}
            </p>
          )
        return (
          <ol key={i} className="pchanges" aria-label="변경 내용">
            {s.actions.map((a, j) => {
              const v = actionView(a)
              return (
                <li key={j} className="pchange" data-escalation={v.escalation}>
                  <p className="pchange__title">
                    {j + 1}. {v.title}
                    {v.escalation && <Badge tone="bad">권한 변경</Badge>}
                  </p>
                  <dl className="pchange__rows">
                    {v.rows.map((r) => (
                      <div key={r.label} className="pchange__row" data-strong={r.strong === true}>
                        <dt>{r.label}</dt>
                        <dd>{r.value}</dd>
                      </div>
                    ))}
                  </dl>
                </li>
              )
            })}
          </ol>
        )
      })}
    </>
  )
}

/** 되돌리기 제안 카드: 앱이 쓴 문구에서 읽은 격리 중 직원을 따로 보여 준다. */
export function QuarantineList({ decision: d }: { decision: Decision }): React.JSX.Element | null {
  if (d.kind !== 'revert-suggestion') return null
  const text = [d.question, ...d.options.map((o) => o.description)].join('\n')
  const ids = quarantinedEmployees(text)
  if (ids.length === 0) return null
  return (
    <p className="dcard__meta">
      격리 중인 직원:{' '}
      {ids.map((id) => (
        <Badge key={id} tone="warn">
          {id}
        </Badge>
      ))}
    </p>
  )
}
