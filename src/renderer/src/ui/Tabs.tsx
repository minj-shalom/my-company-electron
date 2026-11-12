import { useId, useRef } from 'react'
import { nextTabIndex } from './tabs-nav'

export interface TabItem {
  id: string
  label: string
  /** 탭 옆에 붙는 상태 표시 (배지 등). */
  extra?: React.ReactNode
}

interface Props {
  label: string
  tabs: readonly TabItem[]
  selectedId: string
  onSelect: (id: string) => void
  children: React.ReactNode
}

/** 수동 활성화 없는 자동 탭(화살표로 이동하면 바로 선택). 선택된 탭만 tab 순서에 들어간다. */
export function Tabs({ label, tabs, selectedId, onSelect, children }: Props): React.JSX.Element {
  const base = useId()
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const selectedIndex = Math.max(
    0,
    tabs.findIndex((t) => t.id === selectedId)
  )

  const onKeyDown = (e: React.KeyboardEvent): void => {
    const next = nextTabIndex(e.key, selectedIndex, tabs.length)
    if (next === null) return
    e.preventDefault()
    onSelect(tabs[next].id)
    refs.current[next]?.focus()
  }

  return (
    <div>
      <div className="tabs" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
        {tabs.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="tab"
            id={`${base}-tab-${t.id}`}
            aria-selected={i === selectedIndex}
            aria-controls={`${base}-panel`}
            tabIndex={i === selectedIndex ? 0 : -1}
            className="tab"
            onClick={() => onSelect(t.id)}
          >
            {t.label}
            {t.extra}
          </button>
        ))}
      </div>
      <div
        className="tabpanel"
        role="tabpanel"
        id={`${base}-panel`}
        aria-labelledby={`${base}-tab-${tabs[selectedIndex]?.id}`}
      >
        {children}
      </div>
    </div>
  )
}
