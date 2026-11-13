import { useId, useRef, useState } from 'react'
import type { OrgSnapshot } from '../../../shared/org'
import type { ProjectInfo } from '../../../shared/project'
import { runExclusive } from '../lib/refresh'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { ROLE_LABEL, projectCandidates, projectPeople, runAssign } from './assign-model'

/** 프로젝트 카드의 "함께 일하는 직원". 조회가 기본이고 추가/제외는 접힌 보조 영역이다. */
export function ProjectPeople({
  project,
  org,
  onChanged
}: {
  project: ProjectInfo
  /** 조직 조회 상태. 아직 없거나 실패면 null이고 직원 이름은 id로 보인다. */
  org: OrgSnapshot | null
  onChanged: () => void
}): React.JSX.Element {
  const people = projectPeople(project, org)
  const archived = project.status === 'archived'
  const [pick, setPick] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)
  const lock = useRef(false)
  const selectId = useId()
  const candidates = org ? projectCandidates(project, org) : []
  const chosen = candidates.find((c) => c.id === pick)

  const run = (kind: 'assign' | 'unassign', employeeId: string, label: string): void => {
    void runExclusive(lock, async () => {
      setBusy(true)
      setMessage(null)
      const r = await runAssign(
        window.api,
        kind,
        { id: project.id, employeeId },
        { project: project.name, employee: label }
      )
      setBusy(false)
      if (r.ok) {
        setMessage({ text: r.message, error: false })
        setPick('')
        onChanged()
      } else setMessage({ text: r.text, error: true })
    })
  }

  return (
    <div className="project-people">
      <h4 className="project-people__title">함께 일하는 직원</h4>
      {people.length > 0 ? (
        <ul className="project-people__list" aria-label={`${project.name} 직원`}>
          {people.map((p) => (
            <li key={p.id}>
              <span>{p.label}</span>
              <Badge tone={p.role === 'pm' ? 'info' : 'neutral'}>{ROLE_LABEL[p.role]}</Badge>
              {!p.known && <Badge tone="warn">조직도에 없음</Badge>}
              {p.role === 'member' && !archived && (
                <Button
                  size="small"
                  disabled={busy}
                  aria-label={`${p.label}을(를) ${project.name}에서 제외`}
                  onClick={() => run('unassign', p.id, p.label)}
                >
                  제외
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint">아직 함께 일하는 직원이 없어요.</p>
      )}
      {!archived && (
        <details className="project-people__manual">
          <summary>직원 직접 추가 (수동)</summary>
          {org === null ? (
            <p className="hint">직원 정보를 불러오면 추가할 수 있어요.</p>
          ) : candidates.length === 0 ? (
            <p className="hint">추가할 수 있는 직원이 없어요.</p>
          ) : (
            <div className="assigned__add">
              <label htmlFor={selectId}>{project.name}에 추가할 직원</label>
              <select
                id={selectId}
                className="input"
                value={pick}
                disabled={busy}
                onChange={(e) => setPick(e.target.value)}
              >
                <option value="">직원 고르기</option>
                {candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
              <Button
                size="small"
                variant="primary"
                aria-disabled={busy || !chosen}
                onClick={() => !busy && chosen && run('assign', chosen.id, chosen.label)}
              >
                추가
              </Button>
            </div>
          )}
        </details>
      )}
      <div role="status" aria-live="polite" className={busy ? 'hint' : 'visually-hidden'}>
        {busy && '처리하고 있어요…'}
      </div>
      {message && (
        <p role={message.error ? 'alert' : 'status'} className={message.error ? 'error' : 'hint'}>
          {message.text}
        </p>
      )}
    </div>
  )
}
