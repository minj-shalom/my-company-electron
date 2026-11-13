import type { OrgModel } from '../../shared/org'
import type {
  AssignmentIssue,
  EmployeeProjectEntry,
  EmployeeProjectsResult
} from '../../shared/project'
import type { AssignmentSource } from '../employee/employee-service'
import { FsGuardError, type SafeFs } from '../repository/safe-fs'
import {
  PROJECT_FILE,
  parseProjectDoc,
  viewProjectDoc,
  type DocProject,
  type ProjectDoc
} from './project-doc'

/**
 * 프로젝트 배정의 읽기·검증 (T-045). 원본은 `company/project.md` 프로젝트 블록의 `직원:`(일반 배정)과 `PM:`(담당 PM) 줄이다.
 * 줄 해석은 `field-lines`/`project-doc`에 있고 이 모듈은 그 결과를 조직도와 대조한다. 쓰기는 ProjectService가 한다.
 * T-052 검증기가 `validateAssignments`를 그대로 재사용한다. 저장 위치를 바꾸려면 이 모듈의 읽기 함수만 교체한다.
 */

const PROTECTED_IDS: ReadonlySet<string> = new Set(['ceo', 'coo'])
const PROTECTED_TITLES: ReadonlySet<string> = new Set(['ceo', 'coo'])

export type EmployeeAssignability = 'ok' | 'protected' | 'unknown'

/** 배정 대상이 될 수 있는 직원인지. 직원 파일이 있는 org.md의 agent만 `ok`이고 CEO/COO는 `protected`다. */
export function assignability(org: OrgModel, employeeId: string): EmployeeAssignability {
  if (PROTECTED_IDS.has(employeeId)) return 'protected'
  const m = org.members.find((x) => x.kind === 'agent' && x.agentId === employeeId)
  if (m === undefined || !m.fileExists) return 'unknown'
  return PROTECTED_TITLES.has(m.title.trim().toLowerCase()) ? 'protected' : 'ok'
}

export interface AssignmentView {
  /** 직원 id -> 담당 프로젝트 (PM 먼저, 이름순). 보관된 프로젝트도 `active: false`로 포함한다. */
  byEmployee: Map<string, EmployeeProjectEntry[]>
  /** 알 수 없는 직원·보호 직원을 가리키는 줄. 오류로 중단하지 않고 모아서 알린다. 조직도를 읽지 못했으면 비어 있다. */
  issues: AssignmentIssue[]
}

/** 조직도를 읽지 못했으면(`org === null`) 직원 존재 여부를 판단할 수 없으므로 경고를 만들지 않는다. */
export function validateAssignments(items: DocProject[], org: OrgModel | null): AssignmentView {
  const byEmployee = new Map<string, EmployeeProjectEntry[]>()
  const issues: AssignmentIssue[] = []
  const push = (employeeId: string, entry: EmployeeProjectEntry): void => {
    const list = byEmployee.get(employeeId)
    if (list) list.push(entry)
    else byEmployee.set(employeeId, [entry])
  }
  for (const p of items) {
    const base = { projectId: p.id, projectName: p.name, active: p.status === 'active' }
    const refs: { employeeId: string; role: 'pm' | 'member' }[] = []
    if (p.pmId !== null) refs.push({ employeeId: p.pmId, role: 'pm' })
    // PM이 `직원:`에도 있으면 PM 한 건으로만 센다.
    for (const m of p.memberIds) if (m !== p.pmId) refs.push({ employeeId: m, role: 'member' })
    for (const ref of refs) {
      push(ref.employeeId, { ...base, role: ref.role })
      if (org === null) continue
      const a = assignability(org, ref.employeeId)
      if (a !== 'ok')
        issues.push({
          code: a === 'protected' ? 'protected-employee' : 'unknown-employee',
          projectId: p.id,
          employeeId: ref.employeeId,
          role: ref.role
        })
    }
  }
  for (const list of byEmployee.values())
    list.sort(
      (a, b) =>
        (a.role === b.role ? 0 : a.role === 'pm' ? -1 : 1) ||
        a.projectName.localeCompare(b.projectName, 'ko')
    )
  return { byEmployee, issues }
}

export function employeeProjects(
  items: DocProject[],
  org: OrgModel | null,
  employeeId: string
): EmployeeProjectsResult {
  const view = validateAssignments(items, org)
  return {
    employeeId,
    projects: view.byEmployee.get(employeeId) ?? [],
    issues: view.issues.filter((i) => i.employeeId === employeeId)
  }
}

/** 파일이 없거나 읽을 수 없으면 null. 오류 원문(경로 포함 가능)은 버린다. */
export async function readProjectDoc(fs: SafeFs): Promise<ProjectDoc | null> {
  try {
    return parseProjectDoc(await fs.readText(PROJECT_FILE))
  } catch (e) {
    if (e instanceof FsGuardError && e.kind === 'missing') return null
    throw new Error('project.md unreadable', { cause: e })
  }
}

/** 읽을 수 있는 프로젝트 목록. 파일이 없으면 빈 목록, 읽기에 실패하면 던진다 (호출자가 고정 문구로 바꾼다). */
export async function readProjectItems(fs: SafeFs): Promise<DocProject[]> {
  const doc = await readProjectDoc(fs)
  return doc === null ? [] : viewProjectDoc(doc).items
}

/** T-035 `AssignmentSource`의 실제 구현. 직원 퇴사 검사가 쓴다 (보관된 프로젝트의 배정도 포함해 퇴사를 막는다). */
export function createAssignmentSource(fs: SafeFs): AssignmentSource {
  return {
    async listAssignments(employeeId) {
      const view = validateAssignments(await readProjectItems(fs), null)
      return (view.byEmployee.get(employeeId) ?? []).map((e) => ({
        projectId: e.projectId,
        role: e.role
      }))
    }
  }
}
