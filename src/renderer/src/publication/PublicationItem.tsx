import { useId, useState } from 'react'
import type { PublicationEntry } from '../../../shared/publication'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { DraftPreview } from './DraftPreview'
import { approvalLabel, STATUS_META } from './publication-model'

export interface ItemActions {
  /** 실패하면 사용자용 문구, 성공하면 null. */
  approve: (e: PublicationEntry) => Promise<string | null>
  publish: (e: PublicationEntry) => Promise<string | null>
  mark: (e: PublicationEntry, link: string) => Promise<string | null>
}

/** 초안 한 건. 제목·메모·링크는 모두 텍스트 노드로만 그린다. 게시 링크는 눌러서 열리지 않는 복사용 텍스트다. */
export function PublicationItem({
  entry: e,
  projectId,
  locked,
  actions
}: {
  entry: PublicationEntry
  projectId: string
  /** 읽지 못한 기록이 있으면 쓰기를 막는다. */
  locked: boolean
  actions: ItemActions
}): React.JSX.Element {
  const meta = STATUS_META[e.status]
  const approval = approvalLabel(e)
  const linkId = useId()
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const run = async (task: () => Promise<string | null>): Promise<void> => {
    if (busy || locked) return
    setBusy(true)
    setMsg(null)
    try {
      setMsg(await task())
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="pub" data-status={e.status}>
      <div className="pub__top">
        <strong className="pub__title">{e.title}</strong>
        <Badge tone={meta.tone}>{meta.label}</Badge>
        {approval && <Badge tone="info">{approval}</Badge>}
      </div>
      <p className="pub__meta">
        {e.date} · <code>{e.path}</code>
        {e.ticketId && <> · {e.ticketId}</>}
      </p>
      {e.status === 'draft' && e.note !== null && (
        <p className="notice" role="note">
          승인한 뒤 내용이 바뀌었을 수 있어요. 다시 확인하고 승인을 요청해 주세요.
        </p>
      )}
      {e.status === 'rejected' && (
        <p className="pub__note">거절 사유: {e.note ?? '적지 않았어요'}</p>
      )}
      {e.status === 'failed' && (
        <p className="pub__note">발행하지 못했어요. 다시 시도하거나 직접 올린 뒤 표시해 주세요.</p>
      )}
      {e.status === 'published' && (
        <p className="pub__note">
          {e.link ? (
            <>
              게시 링크 (복사해서 쓰세요):{' '}
              <code className="pub__link" tabIndex={0}>
                {e.link}
              </code>
            </>
          ) : (
            '링크는 적지 않았어요.'
          )}
        </p>
      )}
      <DraftPreview projectId={projectId} path={e.path} />
      <div className="pub__actions">
        {e.status === 'draft' && (
          <Button
            size="small"
            aria-disabled={busy || locked}
            onClick={() => void run(() => actions.approve(e))}
          >
            승인 요청
          </Button>
        )}
        {(e.status === 'approved' || e.status === 'publish-requested' || e.status === 'failed') && (
          <Button
            size="small"
            variant="primary"
            aria-disabled={busy || locked}
            onClick={() => void run(() => actions.publish(e))}
          >
            {busy ? '처리 중…' : '발행 진행'}
          </Button>
        )}
      </div>
      {(e.status === 'approved' || e.status === 'publish-requested' || e.status === 'failed') && (
        <form
          className="pub__mark"
          onSubmit={(ev) => {
            ev.preventDefault()
            void run(() => actions.mark(e, link))
          }}
        >
          <div className="field">
            <label htmlFor={linkId}>직접 올렸다면: 게시 링크 (선택, https://)</label>
            <Input
              id={linkId}
              value={link}
              maxLength={500}
              autoComplete="off"
              inputMode="url"
              readOnly={busy}
              onChange={(ev) => setLink(ev.target.value)}
            />
          </div>
          <Button size="small" type="submit" aria-disabled={busy || locked}>
            발행함으로 표시
          </Button>
        </form>
      )}
      {msg && (
        <p role="status" className="pub__msg">
          {msg}
        </p>
      )}
    </li>
  )
}
