import { useId, useRef, useState } from 'react'
import type { OrgSnapshot } from '../../../shared/org'
import { needsHr } from '../hire/hire-model'
import { Button } from '../ui/Button'
import { HireDialog } from './HireDialog'
import { needsLeaveConfirm } from './employee-model'
import { LeaveDialog } from './MemberManager'

/**
 * 채용 진입. 인사팀이 있으면 기본은 "인사팀에 채용 요청"(COO 대화 연결 전이라 비활성)이고 수동 채용은 접힌 메뉴에 둔다.
 * 인사팀이 없으면 "직원 채용"이 기본이다.
 */
export function HireEntry({
  snapshot,
  onHired,
  isDirty,
  offerAssign = false
}: {
  snapshot: OrgSnapshot
  onHired: (employeeId: string, openAssign: boolean) => void
  /** 채용 대화에 "채용 후 담당 프로젝트 배정하기" 선택지를 보인다. */
  offerAssign?: boolean
  /** 편집 중인 변경이 있으면 true. 채용하면 선택이 바뀌어 편집이 사라지므로 먼저 확인한다. */
  isDirty?: () => boolean
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const start = (): void =>
    needsLeaveConfirm(isDirty?.() ?? false, null, 'new-hire') ? setConfirming(true) : setOpen(true)
  const hintId = useId()
  const openerRef = useRef<HTMLButtonElement>(null)
  const hasHr = !needsHr(snapshot)
  const leave = confirming && (
    <LeaveDialog
      onStay={() => setConfirming(false)}
      onLeave={() => {
        setConfirming(false)
        setOpen(true)
      }}
    />
  )
  const dialog = (
    <>
      {leave}
      {open && (
        <HireDialog
          snapshot={snapshot}
          offerAssign={offerAssign}
          onClose={() => {
            setOpen(false)
            openerRef.current?.focus()
          }}
          onHired={(id, openAssign) => {
            setOpen(false)
            onHired(id, openAssign)
          }}
        />
      )}
    </>
  )
  if (!hasHr)
    return (
      <div className="hire-entry">
        <Button variant="primary" ref={openerRef} onClick={start}>
          직원 채용
        </Button>
        {dialog}
      </div>
    )
  return (
    <div className="hire-entry">
      <Button variant="primary" aria-disabled="true" aria-describedby={hintId}>
        인사팀에 채용 요청
      </Button>
      <p id={hintId} className="hint">
        COO 대화가 연결되면 쓸 수 있어요. 지금은 직접 채용을 써 주세요.
      </p>
      <details className="hire-entry__manual">
        <summary>직접 채용(수동)</summary>
        <Button size="small" ref={openerRef} onClick={start}>
          직원 채용
        </Button>
      </details>
      {dialog}
    </div>
  )
}
