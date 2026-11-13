import type { ProposalApplyResult } from '../../shared/proposal'
import type { ApiResult } from '../../shared/result'
import { NoCompanyError, type CompanyContext } from '../company/company-context'
import { EmployeeService } from '../employee/employee-service'
import { violationStoreFor } from '../hr/hr-runtime'
import { integrityFor } from '../integrity/integrity-runtime'
import { policyServiceFor } from '../policy/policy-ipc'
import { createAssignmentSource } from '../project/assignments-store'
import { projectServiceFor } from '../project/project-ipc'
import { sharedRepository } from '../repository/shared-repository'
import type { SafeFs } from '../repository/safe-fs'
import { ProposalService } from './proposal-service'

export interface ProposalIpcDeps {
  context: CompanyContext
  userDataDir?: string
  homeDir?: string
}

export interface ProposalHandlers {
  /** 결재함 승인/거절 이벤트. 입력은 카드 번호와 선택지 key뿐이고 적용 내용은 카드 본문이 정한다. */
  applyProposal: (req: unknown) => Promise<ApiResult<ProposalApplyResult>>
}

const services = new WeakMap<SafeFs, ProposalService>()

export function createProposalHandlers(deps: ProposalIpcDeps): ProposalHandlers {
  return {
    applyProposal: async (req) => {
      try {
        // 저장 위치가 없으면 승인 기록과 격리 상태를 믿을 수 없으므로 동작하지 않는다.
        if (deps.userDataDir === undefined)
          return { ok: false, code: 'internal', message: '요청을 처리하지 못했습니다.' }
        const fs = deps.context.requireOpenCompany().fs
        let svc = services.get(fs)
        if (!svc) {
          const repo = sharedRepository(fs)
          const exclusive = <T>(t: () => Promise<T>): Promise<T> => repo.runExclusive(t)
          const assignments = createAssignmentSource(fs)
          svc = new ProposalService({
            fs,
            exclusive,
            repo,
            employeeFor: (cardId) =>
              new EmployeeService({
                fs,
                exclusive,
                // 지금 적용 중인 이 카드만 승인으로 인정한다 (다른 카드 번호 재사용 차단).
                isApproved: async (id) => id === cardId,
                assignments
              }),
            project: projectServiceFor({ context: deps.context, homeDir: deps.homeDir }),
            policy: policyServiceFor({ context: deps.context }),
            integrity: integrityFor({ context: deps.context, userDataDir: deps.userDataDir }),
            hrScope: violationStoreFor({ context: deps.context, userDataDir: deps.userDataDir })
          })
          services.set(fs, svc)
        }
        return await svc.apply(req)
      } catch (e) {
        if (e instanceof NoCompanyError)
          return { ok: false, code: 'no-company', message: '열린 회사가 없습니다.' }
        return { ok: false, code: 'internal', message: '요청을 처리하지 못했습니다.' }
      }
    }
  }
}
