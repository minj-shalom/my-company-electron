import type { WindowApi } from '../../../shared/api'
import type { EmployeeTemplateInfo } from '../../../shared/employee-change'
import type { OrgSnapshot } from '../../../shared/org'
import { isPmTitle, type ProjectType } from '../../../shared/project'
import type { ProjectTemplateInfo } from '../../../shared/project-template'
import { buildCreateRequest, defaultsFor, existingAgentIds } from '../employee/employee-model'
import { projectErrorText } from './project-model'

/** 추천 직원 한 줄. 이미 있으면 reuse(재사용), 없으면 hire(채용 대상). */
export interface StaffRow {
  templateId: string
  title: string
  reason: string
  isPm: boolean
  mode: 'reuse' | 'hire'
  /** reuse일 때 재사용할 직원 id. */
  employeeId: string | null
  /** reuse일 때 보여 줄 이름. */
  name: string
}

/**
 * 추천 직원 목록을 현재 직원 구성과 맞춘다. PM은 프로필(pm-dev 등)과 상관없이 이미 PM이 있으면 그 PM을 재사용하고
 * (CEO 확정: PM이 있으면 재사용), 나머지는 직원 id가 템플릿 id와 같은 직원이 있을 때 재사용한다.
 */
export function buildStaffRows(
  template: ProjectTemplateInfo,
  catalog: readonly EmployeeTemplateInfo[],
  snapshot: OrgSnapshot
): StaffRow[] {
  const ids = existingAgentIds(snapshot)
  const nameOf = (id: string): string =>
    snapshot.agents.find((a) => a.id === id)?.name.trim() ||
    snapshot.org.members.find((m) => m.agentId === id)?.title ||
    id
  const existingPm = snapshot.org.members.find(
    (m) => m.kind === 'agent' && m.fileExists && m.agentId !== null && isPmTitle(m.title)
  )
  return template.recommendedStaff.map((s) => {
    const title = catalog.find((c) => c.id === s.templateId)?.title ?? s.templateId
    const base = { templateId: s.templateId, title, reason: s.reason, isPm: s.isPm }
    if (s.isPm && existingPm?.agentId)
      return {
        ...base,
        mode: 'reuse',
        employeeId: existingPm.agentId,
        name: nameOf(existingPm.agentId)
      }
    if (ids.has(s.templateId))
      return { ...base, mode: 'reuse', employeeId: s.templateId, name: nameOf(s.templateId) }
    return { ...base, mode: 'hire', employeeId: null, name: title }
  })
}

/** 실행 중 어디까지 됐는지. 다시 시도해도 끝난 단계는 건너뛰어 중복 채용을 막는다. */
export interface SetupProgress {
  projectId: string | null
  policy: 'pending' | 'done' | 'kept'
  /** templateId -> 채용·재사용으로 확정된 직원 id */
  employees: Record<string, string>
  /** templateId -> 프로젝트에 배정(PM이면 지정)까지 끝났는지 */
  assigned: Record<string, boolean>
  failed: string | null
  message: string | null
}

export const emptyProgress = (): SetupProgress => ({
  projectId: null,
  policy: 'pending',
  employees: {},
  assigned: {},
  failed: null,
  message: null
})

export interface SetupInput {
  path: string
  name: string
  template: ProjectTemplateInfo
  rows: readonly StaffRow[]
  catalog: readonly EmployeeTemplateInfo[]
  snapshot: OrgSnapshot
}

type SetupApi = Pick<
  WindowApi,
  | 'addProject'
  | 'applyProjectTemplate'
  | 'createEmployee'
  | 'assignProjectEmployee'
  | 'setProjectPm'
>

const GENERIC_STOP = '여기서 멈췄어요. 끝난 단계는 그대로이고, 이어서 하면 나머지만 진행해요.'

/**
 * 프로젝트 추가 -> 기본 규칙 -> 직원 채용 -> 배정 -> PM 지정을 순서대로 실행한다.
 * 실패하면 그 자리에서 멈추고 진행 상태를 돌려준다. 같은 progress로 다시 부르면 끝난 단계는 건너뛴다.
 * 채용은 항목마다 한 번만 하고, 이미 있다는 응답(conflict)이면 새로 만들지 않고 멈춰 알린다.
 */
export async function runTemplateSetup(
  api: SetupApi,
  input: SetupInput,
  prev: SetupProgress,
  type: ProjectType
): Promise<SetupProgress> {
  const p: SetupProgress = {
    ...prev,
    employees: { ...prev.employees },
    assigned: { ...prev.assigned },
    failed: null,
    message: null
  }
  const stop = (failed: string, message: string): SetupProgress => ({ ...p, failed, message })
  try {
    if (p.projectId === null) {
      const added = await api.addProject({ path: input.path, name: input.name, type })
      if (!added.ok) return stop('project', projectErrorText(added.code, added.message))
      p.projectId = added.value.project.id
    }
    const projectId = p.projectId
    if (p.policy === 'pending') {
      const r = await api.applyProjectTemplate({ projectId, templateId: input.template.id })
      if (r.ok) p.policy = 'done'
      else if (r.code === 'conflict') p.policy = 'kept'
      else return stop('policy', '기본 규칙을 만들지 못했어요. ' + GENERIC_STOP)
    }
    for (const row of input.rows) {
      const key = row.templateId
      if (p.assigned[key]) continue
      if (!p.employees[key]) {
        if (row.mode === 'reuse' && row.employeeId) p.employees[key] = row.employeeId
        else {
          const tpl = input.catalog.find((c) => c.id === key)
          if (!tpl) return stop(key, `"${row.title}" 직군을 찾지 못했어요. ` + GENERIC_STOP)
          const r = await api.createEmployee(
            buildCreateRequest(defaultsFor(tpl, input.snapshot), tpl)
          )
          if (!r.ok)
            return stop(
              key,
              r.code === 'conflict'
                ? `"${row.title}"와(과) 같은 이름이나 직급의 직원이 이미 있어서 새로 채용하지 않았어요. 직원 목록을 확인해 주세요.`
                : r.code === 'approval-required'
                  ? `"${row.title}" 채용은 CEO 승인이 필요해요. 결재함에서 승인을 받은 뒤 이어서 해 주세요.`
                  : `"${row.title}"을(를) 채용하지 못했어요. ` + GENERIC_STOP
            )
          p.employees[key] = r.value.record.employeeId
        }
      }
      const employeeId = p.employees[key]
      const r = row.isPm
        ? await api.setProjectPm({ id: projectId, pm: employeeId })
        : await api.assignProjectEmployee({ id: projectId, employeeId })
      if (!r.ok)
        return stop(
          key,
          `"${row.title}"을(를) ${row.isPm ? '담당 PM으로 지정' : '프로젝트에 배정'}하지 못했어요. ` +
            GENERIC_STOP
        )
      p.assigned[key] = true
    }
    return p
  } catch {
    return stop('unknown', '처리 중 문제가 생겼어요. ' + GENERIC_STOP)
  }
}

export type RowStatus = 'done' | 'failed' | 'pending'

export function rowStatus(row: StaffRow, p: SetupProgress): RowStatus {
  if (p.assigned[row.templateId]) return 'done'
  return p.failed === row.templateId ? 'failed' : 'pending'
}

/** 템플릿 유형에 맞는 것만 고르게 한다. 기타 유형은 템플릿이 없다. */
export const templatesForType = (
  all: readonly ProjectTemplateInfo[],
  type: string
): ProjectTemplateInfo[] => all.filter((t) => t.type === type)
