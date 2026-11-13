import { useRef, useState } from 'react'
import type { OrgSnapshot } from '../../../shared/org'
import { Button } from '../ui/Button'
import { HireDialog } from './HireDialog'
import { needsLeaveConfirm } from './employee-model'
import { LeaveDialog } from './MemberManager'

/** 채용 진입. 버튼은 "직원 채용" 하나다. 내부 처리 경로는 사용자에게 드러내지 않는다. */
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
  const openerRef = useRef<HTMLButtonElement>(null)
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
  return (
    <div className="hire-entry">
      <Button variant="primary" ref={openerRef} onClick={start}>
        직원 채용
      </Button>
      {dialog}
    </div>
  )
}
