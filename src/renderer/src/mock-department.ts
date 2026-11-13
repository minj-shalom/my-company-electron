import type { WindowApi } from '../../shared/api'
import {
  departmentKey,
  validateDepartmentName,
  type DepartmentChangeAction,
  type DepartmentChangeRecord
} from '../../shared/department'
import type { OrgSnapshot } from '../../shared/org'
import type { ApiResult, DomainErrorCode } from '../../shared/result'

/**
 * 브라우저 개발 모드 전용. `?mock-department=ok|approval|forbidden|fail|slow`.
 * 부서 추가·이름 변경·삭제가 성공하면 이후 `getOrg`에 반영된다 (직원 mock 위에 덮어쓴다).
 */
export type DepartmentScenario = 'ok' | 'approval' | 'forbidden' | 'fail' | 'slow'
const SCENARIOS: readonly DepartmentScenario[] = ['ok', 'approval', 'forbidden', 'fail', 'slow']

export function parseDepartmentScenario(search: string): DepartmentScenario {
  const v = new URLSearchParams(search).get('mock-department')
  return SCENARIOS.find((s) => s === v) ?? 'ok'
}

interface Edits {
  renames: Array<[string, string]>
  leads: Map<string, string>
  removed: Set<string>
}
const fresh = (): Edits => ({ renames: [], leads: new Map(), removed: new Set() })
let edits = fresh()

export function resetMockDepartmentEdits(): void {
  edits = fresh()
}

const renamed = (name: string): string =>
  edits.renames.reduce((n, [f, t]) => (n === f ? t : n), name)

/** 시나리오·직원 mock 스냅샷 위에 부서 변경을 덮는다. 변경이 없으면 그대로 돌려준다. */
export function applyDepartmentEdits(snap: OrgSnapshot): OrgSnapshot {
  if (edits.renames.length === 0 && edits.leads.size === 0 && edits.removed.size === 0) return snap
  const members = snap.org.members.map((m) => {
    const lead = m.agentId ? edits.leads.get(m.agentId) : undefined
    return { ...m, department: lead ?? (m.department ? renamed(m.department) : m.department) }
  })
  const used = [...new Set(members.map((m) => m.department ?? ''))].filter(Boolean)
  const known = snap.org.departments.map((d) => renamed(d.name))
  const ordered = [
    ...known.filter((n) => used.includes(n)),
    ...used.filter((n) => !known.includes(n))
  ]
  const empties = [...new Set([...(snap.emptyDepartments ?? []).map(renamed), ...known])].filter(
    (n) => !used.includes(n) && !edits.removed.has(n)
  )
  return {
    ...snap,
    org: {
      ...snap.org,
      members,
      departments: ordered.map((name) => ({
        name,
        members: members.filter((m) => m.department === name).map((m) => m.title)
      }))
    },
    emptyDepartments: empties
  }
}

const record = (
  action: DepartmentChangeAction,
  department: string,
  newName: string | null,
  ids: string[]
): DepartmentChangeRecord => ({
  action,
  department,
  newName,
  affectedEmployeeIds: ids,
  actor: 'ceo-ui',
  approval: null,
  sensitive: false,
  sensitiveReasons: [],
  files: ['company/org.md'],
  at: '2026-11-13T09:00:00.000Z'
})

const FAIL: Partial<Record<DepartmentScenario, DomainErrorCode>> = {
  approval: 'approval-required',
  forbidden: 'forbidden',
  fail: 'internal'
}
const BASE_IDS = ['cto', 'cfo', 'hr']

type DepartmentMockApi = Pick<WindowApi, 'addDepartment' | 'renameDepartment' | 'removeDepartment'>

export function createMockDepartmentApi(
  scenario: DepartmentScenario,
  delayMs: number,
  getOrg: () => Promise<OrgSnapshot | null>
): DepartmentMockApi {
  const wait = (): Promise<void> =>
    new Promise((r) => setTimeout(r, scenario === 'slow' ? Math.max(delayMs, 1) * 5 : delayMs))
  const fail = (code: DomainErrorCode): ApiResult<never> => ({ ok: false, code, message: 'mock' })
  const ok = (r: DepartmentChangeRecord): ApiResult<{ record: DepartmentChangeRecord }> => ({
    ok: true,
    value: { record: r }
  })
  const exists = (snap: OrgSnapshot, name: string): boolean =>
    [...snap.org.departments.map((d) => d.name), ...(snap.emptyDepartments ?? [])].some(
      (d) => departmentKey(d) === departmentKey(name)
    )

  return {
    addDepartment: async (req) => {
      await wait()
      const snap = await getOrg()
      if (!snap) return fail('internal')
      if (validateDepartmentName(req.name)) return fail('invalid-request')
      const blocked = FAIL[scenario]
      if (blocked) return fail(blocked)
      const lead = snap.org.members.find((m) => m.agentId === req.leadId)
      if (!lead) return fail('not-found')
      if (lead.kind !== 'agent') return fail('forbidden')
      if (BASE_IDS.includes(req.leadId) && !req.approval) return fail('approval-required')
      if (exists(snap, req.name)) return fail('conflict')
      edits.leads.set(req.leadId, req.name)
      edits.removed.delete(req.name)
      return ok(record('add', req.name, null, [req.leadId]))
    },
    renameDepartment: async (req) => {
      await wait()
      const snap = await getOrg()
      if (!snap) return fail('internal')
      if (validateDepartmentName(req.to)) return fail('invalid-request')
      const blocked = FAIL[scenario]
      if (blocked) return fail(blocked)
      const dept = snap.org.departments.find((d) => d.name === req.from)
      const isEmpty = (snap.emptyDepartments ?? []).includes(req.from)
      if (!dept && !isEmpty) return fail('not-found')
      const people = snap.org.members.filter((m) => m.department === req.from)
      if (people.some((m) => m.kind !== 'agent')) return fail('forbidden')
      if (people.some((m) => m.agentId && BASE_IDS.includes(m.agentId)) && !req.approval)
        return fail('approval-required')
      if (departmentKey(req.from) !== departmentKey(req.to) && exists(snap, req.to))
        return fail('conflict')
      edits.renames.push([req.from, req.to])
      for (const [id, d] of edits.leads) if (d === req.from) edits.leads.set(id, req.to)
      edits.removed.delete(req.to)
      return ok(
        record(
          'rename',
          req.from,
          req.to,
          people.flatMap((m) => m.agentId ?? [])
        )
      )
    },
    removeDepartment: async (req) => {
      await wait()
      const snap = await getOrg()
      if (!snap) return fail('internal')
      const blocked = FAIL[scenario]
      if (blocked) return fail(blocked)
      if (!exists(snap, req.name)) return fail('not-found')
      if (snap.org.members.some((m) => m.department === req.name)) return fail('conflict')
      edits.removed.add(req.name)
      return ok(record('remove', req.name, null, []))
    }
  }
}
