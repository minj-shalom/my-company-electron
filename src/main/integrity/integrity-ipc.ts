import type { IntegrityActionResult } from '../../shared/integrity'
import type { ApiResult } from '../../shared/result'
import { NoCompanyError } from '../company/company-context'
import { integrityFor, type IntegrityRuntimeDeps } from './integrity-runtime'

export interface IntegrityHandlers {
  /** T-016이 읽는 조회: 격리된 직원 id 목록 (`employee:quarantined`). */
  getQuarantined: () => Promise<ApiResult<string[]>>
  /** CEO가 카드에서 "되돌리기"를 눌렀을 때. */
  restoreIntegrity: () => Promise<ApiResult<IntegrityActionResult>>
  /** CEO가 카드에서 "사후 승인"을 눌렀을 때. */
  acceptIntegrity: () => Promise<ApiResult<IntegrityActionResult>>
}

const fail = (code: 'no-company' | 'internal', message: string): ApiResult<never> => ({
  ok: false,
  code,
  message
})

/**
 * 입력이 없는 핸들러다 (복원 대상은 main이 마지막 정상 스냅샷으로만 정한다. renderer가 경로나 스냅샷 id를 넘기지 않는다).
 * 발신자 신뢰 확인은 등록 쪽(`trustedHandler`)이 한다.
 */
export function createIntegrityHandlers(
  deps: Omit<IntegrityRuntimeDeps, 'userDataDir'> & { userDataDir?: string }
): IntegrityHandlers {
  const call = async <T>(
    fn: (svc: ReturnType<typeof integrityFor>) => Promise<T>
  ): Promise<ApiResult<T>> => {
    try {
      // 저장 위치가 없으면 격리 상태를 믿을 수 없으므로 동작하지 않는다.
      if (deps.userDataDir === undefined) return fail('internal', '요청을 처리하지 못했습니다.')
      const svc = integrityFor({ context: deps.context, userDataDir: deps.userDataDir })
      return { ok: true, value: await fn(svc) }
    } catch (e) {
      if (e instanceof NoCompanyError) return fail('no-company', '열린 회사가 없습니다.')
      return fail('internal', '요청을 처리하지 못했습니다.')
    }
  }
  return {
    getQuarantined: () => call((s) => s.quarantined()),
    restoreIntegrity: () => call((s) => s.restore()),
    acceptIntegrity: () => call((s) => s.accept())
  }
}
