import type { CompanyContext } from '../company/company-context'
import { FsGuardError } from '../repository/safe-fs'
import { gateRuntimeFor } from '../gate/gate-runtime'
import { policyServiceFor } from '../policy/policy-ipc'
import { readProjectItems } from '../project/assignments-store'
import { parseSchedule, SCHEDULE_PATH, type ParsedSchedule } from './schedule-config'
import type { PolicyHoursEntry, SchedulerDeps } from './scheduler'

type CompanyBound = Pick<
  SchedulerDeps,
  'companyKey' | 'loadSchedule' | 'loadPolicyHours' | 'isHalted'
>

/** 열린 회사(CompanyContext)에 묶인 읽기 전용 입력들. 스케줄 파일은 앱이 쓰지 않으므로 쓰기 경로가 없다. */
export function companyBoundDeps(context: CompanyContext, userDataDir: string): CompanyBound {
  return {
    companyKey: () => context.getOpenCompany()?.root ?? null,
    loadSchedule: async (): Promise<ParsedSchedule> => {
      const { fs } = context.requireOpenCompany()
      try {
        return parseSchedule(await fs.readText(SCHEDULE_PATH))
      } catch (e) {
        if (e instanceof FsGuardError && e.kind === 'missing') return parseSchedule(null)
        throw e
      }
    },
    loadPolicyHours: async (): Promise<PolicyHoursEntry[]> => {
      const { fs } = context.requireOpenCompany()
      const svc = policyServiceFor({ context })
      const out: PolicyHoursEntry[] = []
      for (const p of await readProjectItems(fs)) {
        const r = await svc.get({ projectId: p.id })
        out.push({ projectId: p.id, hours: r.ok ? r.value.values.activeHours : null })
      }
      return out
    },
    // 회사 전체 킬 스위치가 켜져 있거나 상태를 읽지 못하면 자동 틱을 시작하지 않는다.
    isHalted: async () => {
      if (context.getOpenCompany() === null) return false
      const state = await gateRuntimeFor({ context, userDataDir }).killSwitch.get()
      return state.company
    }
  }
}
