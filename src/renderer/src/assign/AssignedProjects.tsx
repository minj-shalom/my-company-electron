import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { OrgMember, OrgSnapshot } from '../../../shared/org'
import type { EmployeeProjectEntry, ProjectInfo } from '../../../shared/project'
import { runExclusive } from '../lib/refresh'
import { needsHr } from '../hire/hire-model'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import {
  ROLE_LABEL,
  UNASSIGNED_LABEL,
  agentProjects,
  describeAssignmentIssue,
  employeeCandidates,
  runAssign,
  type NormalizedProject
} from './assign-model'

/** 직원 상세의 "담당 프로젝트". 조회가 기본이고 직접 배정/해제는 접힌 보조 영역에 둔다. */
export function AssignedProjects({
  member,
  snapshot,
  defaultOpen = false,
  onChanged
}: {
  member: OrgMember
  snapshot: OrgSnapshot
  /** 채용 직후 "담당 프로젝트 배정 열기"를 골랐으면 수동 영역을 펼쳐 시작한다. */
  defaultOpen?: boolean
  onChanged: () => void
}): React.JSX.Element {
  const agent = snapshot.agents.find((a) => a.id === member.agentId)
  const list = agentProjects(agent)
  const manual = member.kind === 'agent' && !!member.agentId && member.fileExists
  const hasHr = !needsHr(snapshot)
  const issues = (snapshot.assignmentIssues ?? []).filter((i) => i.employeeId === member.agentId)
  return (
    <div className="assigned">
      <dl className="org-detail__list">
        <dt>담당 프로젝트</dt>
        <dd>
          <ProjectBadges list={list} />
          {list.length === 0 && (
            <p className="hint assigned__note">프로젝트가 없는 동안에는 회사 공통 업무만 맡아요.</p>
          )}
        </dd>
      </dl>
      {issues.length > 0 && (
        <ul className="notice assigned__issues" aria-label="배정 경고">
          {issues.map((i, n) => (
            <li key={n}>{describeAssignmentIssue(i)}</li>
          ))}
        </ul>
      )}
      {manual ? (
        <details className="assigned__manual" open={defaultOpen || undefined}>
          <summary>직접 배정/해제 (수동)</summary>
          <p className="hint">
            {hasHr
              ? '배정은 인사팀에 요청하세요. 인사팀 요청은 COO 대화가 연결되면 쓸 수 있어요. 지금은 여기서 직접 바꿀 수 있어요.'
              : '인사팀이 없어서 여기서 직접 배정해요.'}
          </p>
          <ManualAssign
            key={member.agentId}
            employeeId={member.agentId as string}
            employeeName={member.title}
            onChanged={onChanged}
          />
        </details>
      ) : (
        <p className="hint">CEO와 COO는 회사 전체를 맡아서 프로젝트 배정 대상이 아니에요.</p>
      )}
    </div>
  )
}

/** 역할은 글자로 표시한다 (색만으로 구분하지 않는다). */
export function ProjectBadges({ list }: { list: readonly NormalizedProject[] }): React.JSX.Element {
  return (
    <ul className="org-tools" aria-label="담당 프로젝트">
      {list.length > 0 ? (
        list.map((p) => (
          <li key={p.id}>
            <Badge tone={p.active ? (p.role === 'pm' ? 'info' : 'neutral') : 'warn'}>
              {p.name} · {ROLE_LABEL[p.role]}
              {p.active ? '' : ' · 보관됨(비활성)'}
            </Badge>
          </li>
        ))
      ) : (
        <li>
          <Badge>{UNASSIGNED_LABEL}</Badge>
        </li>
      )}
    </ul>
  )
}

type Load =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; entries: EmployeeProjectEntry[]; projects: ProjectInfo[] }

function ManualAssign({
  employeeId,
  employeeName,
  onChanged
}: {
  employeeId: string
  employeeName: string
  onChanged: () => void
}): React.JSX.Element {
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  const [tick, setTick] = useState(0)
  const [pick, setPick] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ text: string; error: boolean; stale: boolean } | null>(
    null
  )
  const lock = useRef(false)
  const alive = useRef(true)
  const selectId = useId()
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      window.api.listEmployeeProjects({ id: employeeId }),
      window.api.listProjects()
    ])
      .then(([e, p]) => {
        if (cancelled) return
        setLoad(
          e.ok && p.ok
            ? { kind: 'ready', entries: e.value.projects, projects: p.value.items }
            : { kind: 'error' }
        )
      })
      .catch(() => !cancelled && setLoad({ kind: 'error' }))
    return () => {
      cancelled = true
    }
  }, [employeeId, tick])

  const reload = useCallback(() => {
    setLoad({ kind: 'loading' })
    setTick((n) => n + 1)
  }, [])

  const run = (kind: 'assign' | 'unassign', projectId: string, projectName: string): void => {
    void runExclusive(lock, async () => {
      setBusy(true)
      setMessage(null)
      const r = await runAssign(
        window.api,
        kind,
        { id: projectId, employeeId },
        { project: projectName, employee: employeeName }
      )
      if (!alive.current) return
      setBusy(false)
      if (r.ok) {
        setMessage({ text: r.message, error: false, stale: false })
        setPick('')
        onChanged()
        reload()
      } else setMessage({ text: r.text, error: true, stale: r.stale })
    })
  }

  if (load.kind === 'loading')
    return (
      <p role="status" className="hint">
        담당 프로젝트를 불러오고 있어요…
      </p>
    )
  if (load.kind === 'error')
    return (
      <div role="alert" className="error">
        <p>담당 프로젝트를 불러오지 못했어요.</p>
        <Button size="small" onClick={reload}>
          다시 시도
        </Button>
      </div>
    )

  const current: NormalizedProject[] = load.entries.map((e) => ({
    id: e.projectId,
    name: e.projectName,
    role: e.role,
    active: e.active
  }))
  const candidates = employeeCandidates(load.projects, employeeId, current)
  const members = current.filter((p) => p.role === 'member')
  const chosen = candidates.find((c) => c.id === pick)

  return (
    <div className="assigned__body" aria-busy={busy}>
      {members.length > 0 ? (
        <ul className="assigned__rows" aria-label="해제할 수 있는 배정">
          {members.map((p) => (
            <li key={p.id}>
              <span>
                {p.name}
                {p.active ? '' : ' (보관됨)'}
              </span>
              <Button
                size="small"
                disabled={busy}
                aria-label={`${p.name} 배정 해제`}
                onClick={() => run('unassign', p.id, p.name)}
              >
                해제
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint">해제할 팀원 배정이 없어요.</p>
      )}
      {current.some((p) => p.role === 'pm') && (
        <p className="hint">담당 PM은 프로젝트 탭에서 바꾸거나 해제해요.</p>
      )}
      {candidates.length > 0 ? (
        <div className="assigned__add">
          <label htmlFor={selectId}>프로젝트에 배정</label>
          <select
            id={selectId}
            className="input"
            value={pick}
            disabled={busy}
            onChange={(e) => setPick(e.target.value)}
          >
            <option value="">프로젝트 고르기</option>
            {candidates.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <Button
            size="small"
            variant="primary"
            aria-disabled={busy || !chosen}
            onClick={() => !busy && chosen && run('assign', chosen.id, chosen.name)}
          >
            배정
          </Button>
        </div>
      ) : (
        <p className="hint">배정할 수 있는 다른 활성 프로젝트가 없어요.</p>
      )}
      <div role="status" aria-live="polite" className={busy ? 'hint' : 'visually-hidden'}>
        {busy && '처리하고 있어요…'}
      </div>
      {message && (
        <div role={message.error ? 'alert' : 'status'} className={message.error ? 'error' : 'hint'}>
          <p>{message.text}</p>
          {message.stale && (
            <Button size="small" onClick={reload}>
              다시 불러오기
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
