import type { WindowApi } from '../../shared/api'
import type { ChangeRecord, EmployeeTemplateInfo } from '../../shared/employee-change'
import type { OrgAgentDetail, OrgMember, OrgSnapshot, OrgTreeNode } from '../../shared/org'
import type { ApiResult, DomainErrorCode } from '../../shared/result'

/**
 * 브라우저 개발 모드 전용. `?mock-employee=ok|conflict|cycle|forbidden|approval|fail|slow`.
 * 직원 수정·이동·퇴사·채용(hr 외)이 어떤 응답을 받을지 정한다. 성공하면 이후 `getOrg`에 반영된다.
 */
export type EmployeeScenario =
  'ok' | 'conflict' | 'cycle' | 'forbidden' | 'approval' | 'fail' | 'slow'
const SCENARIOS: readonly EmployeeScenario[] = [
  'ok',
  'conflict',
  'cycle',
  'forbidden',
  'approval',
  'fail',
  'slow'
]

export function parseEmployeeScenario(search: string): EmployeeScenario {
  const v = new URLSearchParams(search).get('mock-employee')
  return SCENARIOS.find((s) => s === v) ?? 'ok'
}

interface Edits {
  added: OrgMember[]
  addedAgents: OrgAgentDetail[]
  retired: Set<string>
  moves: Map<string, { department?: string; reportsTo?: string }>
  patches: Map<string, Partial<Pick<OrgAgentDetail, 'description' | 'model' | 'tools'>>>
}

const fresh = (): Edits => ({
  added: [],
  addedAgents: [],
  retired: new Set(),
  moves: new Map(),
  patches: new Map()
})
let edits = fresh()

export function resetMockEmployeeEdits(): void {
  edits = fresh()
}

function buildTree(members: OrgMember[], parent: string | null = null): OrgTreeNode[] {
  return members
    .filter((m) => m.reportsTo === parent)
    .map((m) => ({ member: m, children: buildTree(members, m.title) }))
}

/** 시나리오 스냅샷 위에 mock 쓰기 결과를 덮는다. 쓰기가 없었으면 그대로 돌려준다. */
export function applyEmployeeEdits(snap: OrgSnapshot): OrgSnapshot {
  if (
    snap.org.members.length === 0 ||
    (edits.added.length === 0 &&
      edits.retired.size === 0 &&
      edits.moves.size === 0 &&
      edits.patches.size === 0)
  )
    return snap
  const members = [...snap.org.members, ...edits.added]
    .filter((m) => !(m.agentId && edits.retired.has(m.agentId)))
    .map((m) => ({ ...m, ...(m.agentId ? edits.moves.get(m.agentId) : undefined) }))
  const names = [...new Set(members.map((m) => m.department ?? ''))].filter(Boolean)
  const known = snap.org.departments.map((d) => d.name).filter((n) => names.includes(n))
  const ordered = [...known, ...names.filter((n) => !known.includes(n))]
  return {
    ...snap,
    org: {
      ...snap.org,
      members,
      departments: ordered.map((name) => ({
        name,
        members: members.filter((m) => m.department === name).map((m) => m.title)
      })),
      tree: snap.org.tree.length > 0 ? buildTree(members) : []
    },
    agents: [...snap.agents, ...edits.addedAgents]
      .filter((a) => !edits.retired.has(a.id))
      .map((a) => ({ ...a, ...edits.patches.get(a.id) }))
  }
}

type EmployeeMockApi = Pick<
  WindowApi,
  'createEmployee' | 'updateEmployee' | 'moveEmployee' | 'retireEmployee'
>

const record = (
  employeeId: string,
  action: ChangeRecord['action'],
  changedFields: string[]
): ChangeRecord => ({
  action,
  employeeId,
  actor: 'ceo-ui',
  approval: null,
  sensitive: false,
  sensitiveReasons: [],
  changedFields,
  files: [`.claude/agents/${employeeId}.md`, 'company/org.md'],
  at: '2026-11-13T09:00:00.000Z'
})

const FAIL_CODE: Partial<Record<EmployeeScenario, DomainErrorCode>> = {
  conflict: 'conflict',
  forbidden: 'forbidden',
  approval: 'approval-required',
  fail: 'internal'
}

export function createMockEmployeeApi(
  scenario: EmployeeScenario,
  delayMs: number,
  hireCreate: WindowApi['createEmployee'],
  templates: readonly EmployeeTemplateInfo[]
): { api: EmployeeMockApi } {
  const wait = (): Promise<void> =>
    new Promise((r) => setTimeout(r, scenario === 'slow' ? Math.max(delayMs, 1) * 5 : delayMs))
  const blocked = (action: 'create' | 'update' | 'move' | 'retire'): ApiResult<never> | null => {
    const code =
      scenario === 'cycle' ? (action === 'move' ? 'invalid-request' : null) : FAIL_CODE[scenario]
    return code ? { ok: false, code, message: 'mock' } : null
  }
  const ok = (r: ChangeRecord): ApiResult<{ record: ChangeRecord; warnings: [] }> => ({
    ok: true,
    value: { record: r, warnings: [] }
  })

  return {
    api: {
      createEmployee: async (req) => {
        if (req.templateId === 'hr') return hireCreate(req)
        await wait()
        const f = blocked('create')
        if (f) return f
        const t = templates.find((x) => x.id === req.templateId)
        if (!t) return { ok: false, code: 'invalid-request', message: 'mock' }
        if (edits.addedAgents.some((a) => a.id === req.id))
          return { ok: false, code: 'conflict', message: 'mock' }
        edits.added.push({
          title: req.title ?? t.title,
          kind: 'agent',
          agentId: req.id,
          fileExists: true,
          department: req.department,
          reportsTo: req.reportsTo,
          role: req.role ?? t.role
        })
        edits.addedAgents.push({
          id: req.id,
          name: req.id,
          description: t.description,
          model: t.model,
          tools: [...t.tools]
        })
        return ok(record(req.id, 'create', ['file', 'row']))
      },
      updateEmployee: async (req) => {
        await wait()
        const f = blocked('update')
        if (f) return f
        const patch: Edits['patches'] extends Map<string, infer P> ? P : never = {}
        if (req.description !== undefined) patch.description = req.description
        if (req.model !== undefined) patch.model = req.model
        if (req.tools !== undefined) patch.tools = req.tools
        edits.patches.set(req.id, { ...edits.patches.get(req.id), ...patch })
        return ok(
          record(
            req.id,
            'update',
            Object.keys(req).filter((k) => k !== 'id')
          )
        )
      },
      moveEmployee: async (req) => {
        await wait()
        const f = blocked('move')
        if (f) return f
        const move: { department?: string; reportsTo?: string } = {}
        if (req.department !== undefined) move.department = req.department
        if (req.reportsTo !== undefined) move.reportsTo = req.reportsTo
        edits.moves.set(req.id, { ...edits.moves.get(req.id), ...move })
        return ok(
          record(
            req.id,
            'move',
            Object.keys(req).filter((k) => k !== 'id')
          )
        )
      },
      retireEmployee: async (req) => {
        await wait()
        const f = blocked('retire')
        if (f) return f
        edits.retired.add(req.id)
        return ok(record(req.id, 'retire', ['file', 'row']))
      }
    }
  }
}
