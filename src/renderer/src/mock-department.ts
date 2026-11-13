import type { WindowApi } from '../../shared/api'
import type { DepartmentChangeAction, DepartmentChangeRecord } from '../../shared/department'

/** 브라우저 개발 모드 전용 최소 mock. 상태를 바꾸지 않고 성공 기록만 돌려준다 (시나리오 mock은 T-040 2단계). */
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

export const mockDepartmentApi: Pick<
  WindowApi,
  'addDepartment' | 'renameDepartment' | 'removeDepartment'
> = {
  addDepartment: async (req) => ({
    ok: true,
    value: { record: record('add', req.name, null, [req.leadId]) }
  }),
  renameDepartment: async (req) => ({
    ok: true,
    value: { record: record('rename', req.from, req.to, []) }
  }),
  removeDepartment: async (req) => ({
    ok: true,
    value: { record: record('remove', req.name, null, []) }
  })
}
