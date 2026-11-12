import { useRef, useState } from 'react'
import type { OrgSnapshot } from '../../../shared/org'
import { runExclusive } from '../lib/refresh'
import { Button } from '../ui/Button'
import { needsFirstHire, needsHr, runHrAdd, type HireOutcome } from './hire-model'

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
  const hr = needsHr(snapshot)
  const pm = needsFirstHire(snapshot)
  if (!hr && !pm) return null
  return (
    <div className="hire-banners">
      {hr && <HrAddBanner onChanged={onChanged} />}
      {pm && onFirstHire && <FirstHireBanner onFirstHire={onFirstHire} />}
    </div>
  )
}

export function FirstHireBanner({ onFirstHire }: { onFirstHire: () => void }): React.JSX.Element {
  return (
    <aside className="hire-banner" aria-label="첫 채용 안내">
      <div>
        <p className="hire-banner__title">첫 채용을 시작해 보세요</p>
        <p className="hint">
          아직 PM이 없어요. 프로젝트를 열려면 PM이 필요해요. 필요한 직원은 인사팀에 요청하는 것이
          기본이에요.
        </p>
      </div>
      <Button variant="primary" onClick={onFirstHire}>
        첫 채용 시작
      </Button>
    </aside>
  )
}

export function HrAddBanner({ onChanged }: { onChanged: () => void }): React.JSX.Element {
  const [phase, setPhase] = useState<{ kind: 'idle' } | { kind: 'busy' } | HireOutcome>({
    kind: 'idle'
  })
  const lock = useRef(false)
  const busy = phase.kind === 'busy'
  const add = (): void => {
    void runExclusive(lock, async () => {
      setPhase({ kind: 'busy' })
      const out = await runHrAdd(window.api)
      setPhase(out)
      if (out.kind === 'done') onChanged()
    })
  }
  return (
    <aside className="hire-banner" aria-label="인사팀 추가 안내">
      <div>
        <p className="hire-banner__title">인사팀이 없어요</p>
        <p className="hint">
          이 회사에는 인사팀(hr)이 없어서 COO가 직원 채용을 맡길 곳이 없어요. 버튼을 누르면 인사팀을
          추가해요. 누르기 전에는 아무것도 바뀌지 않아요. 인사팀은 CEO 승인이 필요할 수 있어요.
        </p>
        {phase.kind === 'error' && (
          <p role="alert" className="error">
            {phase.message}
          </p>
        )}
        <div
          role="status"
          aria-live="polite"
          className={phase.kind === 'idle' ? 'visually-hidden' : 'hint'}
        >
          {busy ? '인사팀을 추가하고 있어요…' : phase.kind === 'done' ? phase.message : ''}
        </div>
      </div>
      <Button aria-disabled={busy} onClick={() => !busy && add()}>
        {busy ? '추가하는 중…' : '인사팀 추가'}
      </Button>
    </aside>
  )
}
