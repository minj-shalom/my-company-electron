import { useId, useState } from 'react'
import { Button } from './Button'

/** 읽지 못한 파일 안내(결재함·티켓 보드 공용). 경로는 회사 폴더 기준 상대 경로이고 사유는 고정 문구로만 보여 준다. */
export function UnreadableNotice({
  items,
  summary,
  reasonText
}: {
  items: readonly { path: string; reason: unknown }[]
  summary: (count: number) => string
  reasonText: (reason: unknown) => string
}): React.JSX.Element | null {
  const listId = useId()
  const [open, setOpen] = useState(false)
  if (items.length === 0) return null
  return (
    <div className="notice dunread" role="status">
      <div className="dunread__head">
        <strong>{summary(items.length)}</strong>
        <Button
          size="small"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? '접기' : '목록 보기'}
        </Button>
      </div>
      <ul id={listId} hidden={!open} className="dunread__list">
        {items.map((u) => (
          <li key={`${u.path}:${String(u.reason)}`}>
            <code>{u.path}</code> - {reasonText(u.reason)}
          </li>
        ))}
      </ul>
    </div>
  )
}
