import { useCallback, useEffect, useRef, useState } from 'react'
import type { OrgSnapshot } from '../../../shared/org'

/**
 * 채용 직후 조직을 다시 읽은 결과에 새 직원이 나타나면 선택하고 그 목록 항목으로 포커스를 옮긴다.
 * 움직임 효과는 두지 않으므로 reduced-motion에서도 같다.
 */
export function useNewHire(
  snapshot: OrgSnapshot,
  select: (title: string) => void,
  rootRef: React.RefObject<HTMLElement | null>,
  refresh: () => void
): {
  onHired: (employeeId: string, openAssign?: boolean) => void
  notice: string | null
  /** 채용 직후 담당 프로젝트 배정을 열어 달라고 한 직원 id. */
  assignFor: string | null
} {
  const [hired, setHired] = useState<string | null>(null)
  const [assignFor, setAssignFor] = useState<string | null>(null)
  const handled = useRef<string | null>(null)
  const member = hired ? snapshot.org.members.find((x) => x.agentId === hired) : undefined
  const title = member?.title ?? null

  // 새 직원이 목록에 나타난 순간 한 번만 선택하고, 선택이 그려진 뒤(같은 effect 다음 프레임) 포커스를 옮긴다.
  useEffect(() => {
    if (!hired || !title || handled.current === hired) return
    handled.current = hired
    select(title)
    requestAnimationFrame(() => {
      for (const b of rootRef.current?.querySelectorAll<HTMLElement>('[data-org-item]') ?? [])
        if (b.dataset.orgItem === title) {
          b.focus()
          break
        }
    })
  }, [hired, title, select, rootRef])

  const onHired = useCallback(
    (employeeId: string, openAssign = false) => {
      handled.current = null
      setHired(employeeId)
      setAssignFor(openAssign ? employeeId : null)
      refresh()
    },
    [refresh]
  )
  return { onHired, notice: title ? `${title} 직원을 채용했어요.` : null, assignFor }
}
