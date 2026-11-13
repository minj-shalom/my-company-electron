import { useId } from 'react'
import { Badge } from '../ui/Badge'
import type { PmCandidate, PmChoice } from './project-model'

/**
 * 담당 PM 선택. (a) 회사에 PM이 있으면 목록(첫 후보 추천), (b) 없으면 인사팀 PM 채용이 기본,
 * (c) 나중에 정하기. PM이 이미 있으면 채용은 main이 거부하므로 채용 항목을 보여 주지 않는다.
 */
export function PmFields({
  pms,
  choice,
  disabled,
  allowLater = true,
  onChange
}: {
  pms: readonly PmCandidate[]
  choice: PmChoice
  disabled?: boolean
  allowLater?: boolean
  onChange: (c: PmChoice) => void
}): React.JSX.Element {
  const name = useId()
  const hireHint = useId()
  const laterHint = useId()
  return (
    <fieldset className="pm-fields" disabled={disabled}>
      <legend>담당 PM</legend>
      <p className="hint">프로젝트를 운영하려면 PM이 필요해요. 프로젝트마다 한 명이에요.</p>
      {pms.map((p, i) => (
        <label key={p.id} className="pm-fields__option">
          <input
            type="radio"
            name={name}
            checked={choice.kind === 'existing' && choice.id === p.id}
            onChange={() => onChange({ kind: 'existing', id: p.id })}
          />
          <span>{p.name}</span>
          {i === 0 && pms.length > 1 ? <Badge tone="info">추천</Badge> : null}
        </label>
      ))}
      {pms.length === 0 && (
        <>
          <label className="pm-fields__option">
            <input
              type="radio"
              name={name}
              checked={choice.kind === 'hire'}
              aria-describedby={hireHint}
              onChange={() => onChange({ kind: 'hire' })}
            />
            <span>인사팀에 PM 채용 요청</span>
          </label>
          <p id={hireHint} className="hint pm-fields__hint">
            회사에 PM이 아직 없어요. 지금은 AI 사용량 없이 앱이 PM을 바로 채용하고 이 프로젝트의
            담당으로 지정해요. 인사팀 요청 방식은 준비 중이에요.
          </p>
        </>
      )}
      {allowLater && (
        <>
          <label className="pm-fields__option">
            <input
              type="radio"
              name={name}
              checked={choice.kind === 'later'}
              aria-describedby={laterHint}
              onChange={() => onChange({ kind: 'later' })}
            />
            <span>나중에 정하기</span>
          </label>
          <p id={laterHint} className="hint pm-fields__hint">
            &ldquo;PM 필요&rdquo; 상태로 등록돼요. 티켓은 만들 수 있지만 PM을 정하기 전에는 실행되지
            않아요.
          </p>
        </>
      )}
    </fieldset>
  )
}
