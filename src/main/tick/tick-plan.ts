import { projectState, type ProjectInfo } from '../../shared/project'
import type { Ticket } from '../../shared/ticket'
import type { TickSnapshot } from './tick-types'

export type SkipReason =
  | 'outside-hours' // 프로젝트 정책 활동 시간 밖이거나 정책을 읽지 못해 이번 틱 허용 목록에 없음
  | 'project-unknown' // 등록되지 않았거나 목록을 읽지 못함
  | 'project-archived'
  | 'pm-required'
  | 'staff-missing' // 담당 비었음 또는 조직에 없는 직원
  | 'quarantined'
  | 'not-assigned' // 담당이 프로젝트에 배정되지 않음

export interface Skip {
  ticketId: string
  reason: SkipReason
  projectId: string | null
  /** 브리핑에 쓰는 한국어 한 줄. */
  note: string
}

export type SideEffect =
  | {
      type: 'hr'
      kind: 'hire' | 'pm-required' | 'pm-add'
      ticketId: string
      projectId: string | null
      reason: string
    }
  | { type: 'assign'; projectId: string; employeeId: string; ticketId: string }

export interface Selected {
  ticket: Ticket
  project: ProjectInfo | null
  assignee: string
  /** 프로젝트 담당 PM id. 프로젝트 소속이 아니면 null. */
  pmId: string | null
}

export interface TickPlan {
  selected: Selected | null
  skipped: Skip[]
  effects: SideEffect[]
  /** PM 한 명이 이만큼 이상의 활성 프로젝트를 맡으면 브리핑에 알린다. */
  notes: string[]
}

const MAX_EXAMINED = 30
export const PM_OVERLOAD_PROJECTS = 3

/**
 * 틱이 이번에 실행할 티켓 하나를 고른다. 순수 함수이며 파일·프로세스를 건드리지 않는다.
 * 건너뛴 티켓은 이유와 필요한 후속 요청(인사 요청, 배정 제안)을 남기고 다음 티켓으로 넘어간다.
 * `allowedProjectIds`가 배열이면 그 안의 프로젝트만 다룬다. 빈 배열은 어떤 프로젝트도 다루지 않는다는 뜻이다.
 */
export function planTick(snapshot: TickSnapshot, allowedProjectIds: string[] | null): TickPlan {
  const plan: TickPlan = { selected: null, skipped: [], effects: [], notes: [] }
  const allowed = allowedProjectIds === null ? null : new Set(allowedProjectIds)
  const candidates = snapshot.tickets.filter((t) => t.status !== 'done').slice(0, MAX_EXAMINED)
  const agents = new Set(
    (snapshot.org?.members ?? [])
      .filter((m) => m.kind === 'agent' && m.fileExists && m.agentId !== null)
      .map((m) => m.agentId as string)
  )

  const skip = (t: Ticket, reason: SkipReason, note: string): void => {
    plan.skipped.push({ ticketId: t.id, reason, projectId: t.projectId ?? null, note })
  }

  for (const t of candidates) {
    const projectId = t.projectId ?? null
    let project: ProjectInfo | null = null
    if (projectId !== null) {
      if (allowed !== null && !allowed.has(projectId)) {
        skip(t, 'outside-hours', `${projectId}: 이번 틱에서 다룰 수 없는 프로젝트라 건너뜀`)
        continue
      }
      project = snapshot.projects?.find((p) => p.id === projectId) ?? null
      if (project === null) {
        skip(t, 'project-unknown', `${projectId}: 등록된 프로젝트를 확인하지 못해 건너뜀`)
        continue
      }
      const state = projectState(project, snapshot.org)
      if (state === 'archived') {
        skip(t, 'project-archived', `${projectId}: 보관된 프로젝트`)
        continue
      }
      if (state === 'pm-required') {
        skip(t, 'pm-required', `PM 필요: ${project.name}`)
        plan.effects.push({
          type: 'hr',
          kind: 'pm-required',
          ticketId: t.id,
          projectId,
          reason: `PM 필요: ${project.name} 프로젝트의 PM 채용·지정`
        })
        continue
      }
    }
    const assignee = t.assignee
    if (assignee === null || !agents.has(assignee)) {
      skip(t, 'staff-missing', `채용 필요: ${t.id}의 담당 직원이 없거나 조직에 없음`)
      plan.effects.push({
        type: 'hr',
        kind: 'hire',
        ticketId: t.id,
        projectId,
        reason: `채용 필요: ${t.id} 담당 직원`
      })
      continue
    }
    if (snapshot.quarantined.has(assignee)) {
      skip(t, 'quarantined', `격리된 직원(${assignee})이라 실행하지 않음`)
      continue
    }
    if (
      project !== null &&
      project.pmId !== assignee &&
      !(project.memberIds ?? []).includes(assignee)
    ) {
      skip(t, 'not-assigned', `${assignee}은(는) ${project.name} 프로젝트에 배정되지 않음`)
      plan.effects.push({
        type: 'assign',
        projectId: project.id,
        employeeId: assignee,
        ticketId: t.id
      })
      continue
    }
    plan.selected = { ticket: t, project, assignee, pmId: project?.pmId ?? null }
    break
  }

  const load = new Map<string, number>()
  for (const p of snapshot.projects ?? [])
    if (p.status === 'active' && p.pmId !== null) load.set(p.pmId, (load.get(p.pmId) ?? 0) + 1)
  for (const [pm, n] of load) {
    if (n >= PM_OVERLOAD_PROJECTS && plan.selected?.pmId === pm) {
      plan.notes.push(
        `PM ${pm}이(가) 활성 프로젝트 ${n}개를 맡고 있어요. PM 추가 채용을 제안할 수 있어요.`
      )
      plan.effects.push({
        type: 'hr',
        kind: 'pm-add',
        ticketId: plan.selected.ticket.id,
        projectId: plan.selected.project?.id ?? null,
        reason: `PM ${pm}의 프로젝트가 ${n}개로 몰림: PM 추가 채용 제안`
      })
    }
  }
  return plan
}
