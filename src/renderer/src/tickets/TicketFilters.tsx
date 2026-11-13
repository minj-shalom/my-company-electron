import { Button } from '../ui/Button'
import {
  assigneeOptions,
  departmentOptions,
  hasActiveFilter,
  type FilterOption,
  type FilterValue,
  type TicketFilters as Filters
} from './ticket-view'
import type { Ticket } from '../../../shared/ticket'

function ChipGroup({
  label,
  options,
  value,
  onChange
}: {
  label: string
  options: FilterOption[]
  value: FilterValue
  onChange: (v: FilterValue) => void
}): React.JSX.Element {
  return (
    <div className="dfilters" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.key === null ? '*' : `v:${o.key}`}
          type="button"
          className="dchip"
          aria-pressed={value === o.key}
          onClick={() => onChange(o.key)}
        >
          {o.label} {o.count}
        </button>
      ))}
    </div>
  )
}

/** 부서와 담당 필터. 프로젝트 필터(T-042)는 같은 모양의 ChipGroup을 하나 더 끼우면 된다. */
export function TicketFilters({
  items,
  filters,
  onChange
}: {
  items: readonly Ticket[]
  filters: Filters
  onChange: (f: Filters) => void
}): React.JSX.Element {
  return (
    <div className="tfilters">
      <ChipGroup
        label="부서 필터"
        options={departmentOptions(items, filters)}
        value={filters.department}
        onChange={(department) => onChange({ ...filters, department })}
      />
      <ChipGroup
        label="담당 필터"
        options={assigneeOptions(items, filters)}
        value={filters.assignee}
        onChange={(assignee) => onChange({ ...filters, assignee })}
      />
      {hasActiveFilter(filters) && (
        <Button size="small" onClick={() => onChange({ department: null, assignee: null })}>
          필터 해제
        </Button>
      )}
    </div>
  )
}
