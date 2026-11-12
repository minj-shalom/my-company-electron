import { useRef, useState } from 'react'
import { nextListIndex } from './org-view'
import { TabbableContext } from './tabbable-context'

export function RovingList({
  titles,
  selected,
  children
}: {
  titles: string[]
  selected: string | null
  children: React.ReactNode
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [focused, setFocused] = useState<string | null>(null)
  const active =
    (focused && titles.includes(focused) ? focused : null) ??
    (selected && titles.includes(selected) ? selected : null) ??
    titles[0]

  const onKeyDown = (e: React.KeyboardEvent): void => {
    const current = titles.indexOf(document.activeElement?.getAttribute('data-org-item') ?? '')
    if (current < 0) return
    const next = nextListIndex(e.key, current, titles.length)
    if (next === null) return
    e.preventDefault()
    setFocused(titles[next])
    for (const b of ref.current?.querySelectorAll<HTMLButtonElement>('[data-org-item]') ?? []) {
      if (b.dataset.orgItem === titles[next]) b.focus()
    }
  }

  const onFocus = (e: React.FocusEvent): void => {
    const t = (e.target as HTMLElement).getAttribute('data-org-item')
    if (t) setFocused(t)
  }

  return (
    <TabbableContext value={active}>
      <div ref={ref} onKeyDown={onKeyDown} onFocus={onFocus}>
        {children}
      </div>
    </TabbableContext>
  )
}
