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

/** 프로젝트(T-042), 부서, 담당 필터. */
export function TicketFilters({
  items,
  filters,
  onChange,
  project
}: {
  items: readonly Ticket[]
  filters: Filters
  onChange: (f: Filters) => void
  /** 프로젝트 칩. 프로젝트 목록을 읽지 못했으면 생략한다. */
  project?: { options: FilterOption[]; value: FilterValue; onChange: (v: FilterValue) => void }
}): React.JSX.Element {
  return (
    <div className="tfilters">
      {project && (
        <ChipGroup
          label="프로젝트 필터"
          options={project.options}
          value={project.value}
          onChange={project.onChange}
        />
      )}
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
