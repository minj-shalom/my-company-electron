import { useId, useRef, useState } from 'react'
import { Button } from '../ui/Button'
import { readDraftText, UNTRUSTED_NOTE, type DraftText } from './publication-model'

type State = { kind: 'closed' } | { kind: 'loading' } | DraftText

/** 초안 본문을 평문으로만 보여 준다 (React 텍스트 노드, 읽기 전용 pre). 마크다운이나 HTML로 해석하지 않는다. */
export function DraftPreview({
  projectId,
  path
}: {
  projectId: string
  path: string
}): React.JSX.Element {
  const [state, setState] = useState<State>({ kind: 'closed' })
  const bodyId = useId()
  const seq = useRef(0)
  const open = state.kind !== 'closed'

  const toggle = (): void => {
    seq.current += 1
    if (open) {
      setState({ kind: 'closed' })
      return
    }
    const mine = seq.current
    setState({ kind: 'loading' })
    void readDraftText(window.api, projectId, path).then((r) => {
      if (seq.current === mine) setState(r)
    })
  }

  return (
    <div className="draft">
      <Button size="small" aria-expanded={open} aria-controls={bodyId} onClick={toggle}>
        {open ? `초안 닫기 (${path})` : `초안 보기 (${path})`}
      </Button>
      <div id={bodyId} hidden={!open} className="draft__body">
        {state.kind === 'loading' && (
          <p className="hint" role="status">
            초안을 불러오고 있어요…
          </p>
        )}
        {state.kind === 'error' && (
          <p role="alert" className="error">
            {state.message}
          </p>
        )}
        {state.kind === 'ready' && (
          <>
            <p className="hint">{UNTRUSTED_NOTE}</p>
            <pre className="draft__text" tabIndex={0} aria-label={`초안 본문, 읽기 전용: ${path}`}>
              {state.text}
            </pre>
            {state.truncated && <p className="hint">길어서 앞부분만 보여 줘요.</p>}
          </>
        )}
      </div>
    </div>
  )
}
