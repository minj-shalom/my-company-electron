import { useEffect, useId, useRef } from 'react'
import type { FirstHireRole } from '../../../shared/company-hire'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Panel } from '../ui/Panel'
import { rolesToHire, type FirstHireLoad, type HireOutcome } from './hire-model'

export type HirePhase = { kind: 'idle' } | { kind: 'busy' } | HireOutcome

export interface FirstHireViewProps {
  load: FirstHireLoad
  selected: ReadonlySet<string>
  phase: HirePhase
  onToggle: (id: FirstHireRole) => void
  onHire: () => void
  onRetry: () => void
  /** changed: 채용이 일어났는지. 닫을 때 조직 화면을 다시 읽게 한다. */
  onClose: (changed: boolean) => void
}

/** 첫 채용 화면의 표시 부분. 상태는 container가 들고 있어 renderToStaticMarkup으로 모든 상태를 검증할 수 있다. */
export function FirstHireView(props: FirstHireViewProps): React.JSX.Element {
  const { load, phase, onClose } = props
  const headingRef = useRef<HTMLHeadingElement>(null)
  const doneRef = useRef<HTMLButtonElement>(null)
  // 화면이 열리면 제목으로, 채용이 끝나면 닫기 버튼으로 포커스를 옮겨 키보드 사용자가 위치를 잃지 않게 한다.
  useEffect(() => {
    headingRef.current?.focus()
  }, [])
  useEffect(() => {
    if (phase.kind === 'done') doneRef.current?.focus()
  }, [phase.kind])

  return (
    <section className="first-hire" aria-labelledby="first-hire-heading">
      <h2 id="first-hire-heading" tabIndex={-1} ref={headingRef}>
        첫 채용
      </h2>
      <p className="first-hire__lead">
        지금 회사에는 CTO, CFO, 인사팀뿐이에요. 프로젝트를 열려면 PM이 필요해요.
      </p>
      {load.kind === 'loading' && (
        <p role="status" aria-live="polite" className="hint">
          추천 직원을 불러오고 있어요…
        </p>
      )}
      {load.kind === 'error' && (
        <Panel>
          <p role="alert" className="error">
            {load.message}
          </p>
          <div className="first-hire__actions">
            <Button onClick={props.onRetry}>다시 시도</Button>
            <Button onClick={() => onClose(false)}>나중에</Button>
          </div>
        </Panel>
      )}
      {load.kind === 'ready' && phase.kind === 'done' && (
        <Panel>
          <p role="status" aria-live="polite" className="first-hire__done">
            {phase.message}
          </p>
          <p className="hint">다음 단계는 프로젝트를 추가하고 담당 PM을 정하는 거예요.</p>
          <div className="first-hire__actions">
            <Button variant="primary" ref={doneRef} onClick={() => onClose(phase.hired.length > 0)}>
              확인
            </Button>
          </div>
        </Panel>
      )}
      {load.kind === 'ready' && phase.kind !== 'done' && <Ready {...props} load={load} />}
    </section>
  )
}

function Ready({
  load,
  selected,
  phase,
  onToggle,
  onHire,
  onClose
}: FirstHireViewProps & { load: Extract<FirstHireLoad, { kind: 'ready' }> }): React.JSX.Element {
  const directId = useId()
  const busy = phase.kind === 'busy'
  const roles = rolesToHire(load.cards, selected)
  const allExist = load.cards.every((c) => c.exists)
  const directBlocked = busy || roles.length === 0

  return (
    <>
      <Panel
        title="추천 팀"
        titleExtra={<span className="hint">프로젝트에 따라 달라질 수 있어요</span>}
      >
        <ul className="first-hire__cards" aria-label="추천 직원">
          {load.cards.map((c) => (
            <li key={c.id} className="hire-card" data-exists={c.exists}>
              <label className="hire-card__label">
                <input
                  type="checkbox"
                  checked={c.exists || selected.has(c.id)}
                  disabled={c.exists}
                  aria-disabled={busy || undefined}
                  onChange={() => !busy && onToggle(c.id)}
                />
                <span className="hire-card__title">{c.title}</span>
                {c.exists ? <Badge tone="good">이미 있어요</Badge> : null}
                {!c.exists && c.id === 'pm' ? <Badge tone="info">먼저 필요해요</Badge> : null}
              </label>
              <p className="hire-card__desc">{c.description}</p>
              <p className="hint">{c.note}</p>
            </li>
          ))}
        </ul>
      </Panel>

      {allExist ? (
        <p role="status" className="hint">
          추천 직원이 이미 모두 있어요. 더 필요한 직원은 인사 관리 탭에서 채용해 주세요.
        </p>
      ) : (
        <div className="first-hire__choice first-hire__choice--main">
          <Button
            variant="primary"
            aria-disabled={directBlocked}
            aria-describedby={directId}
            onClick={() => !directBlocked && onHire()}
          >
            {busy ? '채용하는 중…' : '직원 채용'}
          </Button>
          <p id={directId} className="hint">
            {roles.length === 0
              ? '채용할 직원을 하나 이상 골라 주세요.'
              : '고른 직원을 바로 채용해요.'}
          </p>
        </div>
      )}
      <div role="status" aria-live="polite" className={busy ? 'hint' : 'visually-hidden'}>
        {busy && '직원을 채용하고 있어요…'}
      </div>
      {phase.kind === 'error' && (
        <p role="alert" className="error">
          {phase.message}
        </p>
      )}
      <div className="first-hire__actions">
        <Button aria-disabled={busy} onClick={() => !busy && onClose(false)}>
          나중에
        </Button>
        <span className="hint">
          나중에 인사 관리 탭이나 사무실의 직원 채용 버튼으로도 채용할 수 있어요.
        </span>
      </div>
    </>
  )
}
