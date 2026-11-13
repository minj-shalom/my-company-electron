import { useId } from 'react'
import type { ProjectInfo } from '../../../shared/project'

/** 상단 "현재 프로젝트" 선택. 보기 필터일 뿐이라 프로젝트와 티켓 데이터는 바뀌지 않는다. */
export function ProjectFilter({
  items,
  value,
  onChange
}: {
  items: readonly ProjectInfo[]
  value: string | null
  onChange: (id: string | null) => void
}): React.JSX.Element {
  const id = useId()
  const hintId = useId()
  const active = items.filter((p) => p.status === 'active')
  return (
    <div className="project-filter">
      <label htmlFor={id} className="project-filter__label">
        현재 프로젝트
      </label>
      <select
        id={id}
        className="input project-filter__select"
        value={value ?? ''}
        aria-describedby={hintId}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
      >
        <option value="">전체</option>
        {active.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <span id={hintId} className="visually-hidden">
        보기 필터일 뿐이에요. 프로젝트와 티켓은 바뀌지 않아요.
      </span>
    </div>
  )
}
