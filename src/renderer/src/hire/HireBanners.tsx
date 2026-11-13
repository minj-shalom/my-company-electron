import { useEffect, useRef, useState } from 'react'
import type { OrgSnapshot } from '../../../shared/org'
import { Button } from '../ui/Button'
import { addHrOnce, needsFirstHire, needsHr, type HireOutcome } from './hire-model'

/**
 * 조직 화면 위에 놓는 채용 안내. 사용자가 버튼을 누를 때만 회사를 바꾼다 (자동 변경 없음).
 * 인사팀이 없으면 인사팀 추가가, PM이 없으면 첫 채용 안내가 나온다.
 */
export function HireBanners({
  snapshot,
  onFirstHire,
  onChanged
}: {
  snapshot: OrgSnapshot
  onFirstHire?: () => void
  onChanged: () => void
}): React.JSX.Element | null {
  // 성공하면 조직이 새로 읽혀 hr 안내가 사라지므로, 성공 공지는 여기(계속 마운트되는 곳)에서 유지한다.
  const [hrPhase, setHrPhase] = useState<HrPhase>({ kind: 'idle' })
  const lock = useRef(false)
  const doneRef = useRef<HTMLParagraphElement>(null)
  const done = hrPhase.kind === 'done'
  useEffect(() => {
    if (done) doneRef.current?.focus()
  }, [done])
  const add = (): void => {
    void addHrOnce(lock, window.api, () => setHrPhase({ kind: 'busy' })).then((out) => {
      if (!out) return
      setHrPhase(out)
      if (out.kind === 'done') onChanged()
    })
  }
  const hr = needsHr(snapshot)
  const pm = needsFirstHire(snapshot)
  if (!hr && !pm && !done) return null
  return (
    <div className="hire-banners">
      {done && (
        <p role="status" className="hire-banner hire-banner__done" tabIndex={-1} ref={doneRef}>
          {hrPhase.message}
        </p>
      )}
      {hr && !done && <HrAddBanner phase={hrPhase} onAdd={add} />}
      {pm && onFirstHire && <FirstHireBanner onFirstHire={onFirstHire} />}
    </div>
  )
}

export function FirstHireBanner({ onFirstHire }: { onFirstHire: () => void }): React.JSX.Element {
  return (
    <aside className="hire-banner" aria-label="첫 채용 안내">
      <div>
        <p className="hire-banner__title">첫 채용을 시작해 보세요</p>
        <p className="hint">아직 PM이 없어요. 프로젝트를 열려면 PM이 필요해요.</p>
      </div>
      <Button variant="primary" data-first-hire-cta onClick={onFirstHire}>
        첫 채용 시작
      </Button>
    </aside>
  )
}

export type HrPhase = { kind: 'idle' } | { kind: 'busy' } | HireOutcome

export function HrAddBanner({
  phase,
  onAdd
}: {
  phase: HrPhase
  onAdd: () => void
}): React.JSX.Element {
  const busy = phase.kind === 'busy'
  return (
    <aside className="hire-banner" aria-label="인사팀 추가 안내">
      <div>
        <p className="hire-banner__title">인사팀이 없어요</p>
        <p className="hint">
          채용을 맡을 인사팀이 아직 없어요. 버튼을 누르면 인사팀을 추가해요. 누르기 전에는 아무것도
          바뀌지 않아요. CEO 승인이 필요할 수 있어요.
        </p>
        {phase.kind === 'error' && (
          <p role="alert" className="error">
            {phase.message}
          </p>
        )}
        <div role="status" aria-live="polite" className={busy ? 'hint' : 'visually-hidden'}>
          {busy && '인사팀을 추가하고 있어요…'}
        </div>
      </div>
      <Button aria-disabled={busy} onClick={() => !busy && onAdd()}>
        {busy ? '추가하는 중…' : '인사팀 추가'}
      </Button>
    </aside>
  )
}
