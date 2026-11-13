import type { ApiResult } from '../../shared/result'
import type { AuditSummary, KillSwitchState } from '../../shared/gate'
import { PROJECT_ID } from '../../shared/project'
import { NoCompanyError } from '../company/company-context'
import { gateRuntimeFor, type GateRuntimeDeps } from './gate-runtime'

export interface GateHandlers {
  getKillSwitch: () => Promise<ApiResult<KillSwitchState>>
  setKillSwitch: (req: unknown) => Promise<ApiResult<KillSwitchState>>
  getAuditSummary: (req: unknown) => Promise<ApiResult<AuditSummary>>
}

const fail = (
  code: 'invalid-request' | 'no-company' | 'internal',
  message: string
): ApiResult<never> => ({ ok: false, code, message })

const MAX_RANGE_MS = 366 * 24 * 3600 * 1000
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

function parseDate(v: unknown): Date | null {
  if (typeof v !== 'string' || v.length > 40) return null
  const t = Date.parse(v)
  return Number.isNaN(t) ? null : new Date(t)
}

/**
 * 킬 스위치와 자동 실행 요약 핸들러. 발신자 신뢰 확인은 등록 쪽(`trustedHandler`)이 한다.
 * 킬 스위치 켜기/해제는 이 경로(renderer 클릭)로만 바뀌며 게이트 도구 서버는 `set`에 접근하지 못한다.
 */
export function createGateHandlers(
  deps: Omit<GateRuntimeDeps, 'userDataDir'> & { userDataDir?: string }
): GateHandlers {
  const call = async <T>(
    fn: (rt: ReturnType<typeof gateRuntimeFor>) => Promise<ApiResult<T>>
  ): Promise<ApiResult<T>> => {
    try {
      // 상태 저장 위치가 없으면 킬 스위치를 믿을 수 없으므로 동작하지 않는다.
      if (deps.userDataDir === undefined) return fail('internal', '요청을 처리하지 못했습니다.')
      return await fn(gateRuntimeFor({ ...deps, userDataDir: deps.userDataDir }))
    } catch (e) {
      if (e instanceof NoCompanyError) return fail('no-company', '열린 회사가 없습니다.')
      return fail('internal', '요청을 처리하지 못했습니다.')
    }
  }
  return {
    getKillSwitch: () => call(async (rt) => ({ ok: true, value: await rt.killSwitch.get() })),
    setKillSwitch: (raw) => {
      if (!isRecord(raw) || typeof raw.engaged !== 'boolean')
        return Promise.resolve(fail('invalid-request', '요청이 올바르지 않습니다.'))
      const { scope, projectId, engaged } = raw
      if (scope !== 'company' && scope !== 'project')
        return Promise.resolve(fail('invalid-request', '범위가 올바르지 않습니다.'))
      if (scope === 'project' && (typeof projectId !== 'string' || !PROJECT_ID.test(projectId)))
        return Promise.resolve(fail('invalid-request', '프로젝트 id가 올바르지 않습니다.'))
      return call(async (rt) => ({
        ok: true,
        value: await rt.killSwitch.set({
          scope,
          projectId: scope === 'project' ? (projectId as string) : undefined,
          engaged
        })
      }))
    },
    getAuditSummary: (raw) => {
      const from = isRecord(raw) ? parseDate(raw.from) : null
      const to = isRecord(raw) ? parseDate(raw.to) : null
      if (
        from === null ||
        to === null ||
        to <= from ||
        to.getTime() - from.getTime() > MAX_RANGE_MS
      )
        return Promise.resolve(fail('invalid-request', '기간이 올바르지 않습니다.'))
      return call(async (rt) => ({ ok: true, value: await rt.audit.summary(from, to) }))
    }
  }
}
