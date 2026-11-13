import { useEffect, useRef } from 'react'

/**
 * 네이티브 `<dialog>` 모달. 포커스 가두기, Esc 닫기, 닫은 뒤 포커스 복귀를 브라우저가 처리한다.
 * 처리 중(busy)에는 Esc로 닫히지 않게 막는다.
 */
export function Modal({
  labelledBy,
  busy = false,
  onClose,
  children
}: {
  labelledBy: string
  busy?: boolean
  onClose: () => void
  children: React.ReactNode
}): React.JSX.Element {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
    return () => {
      if (dialog?.open) dialog.close()
    }
  }, [])
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby={labelledBy}
      onCancel={(e) => {
        e.preventDefault()
        if (!busy) onClose()
      }}
    >
      {children}
    </dialog>
  )
}
