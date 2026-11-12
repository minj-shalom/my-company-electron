import type { WindowApi } from '../../shared/api'
import type { CompanyInfo, CompanyState } from '../../shared/company'
import { mockCompany } from './mock-data'

/**
 * 브라우저 개발 모드 전용. `?mock-company=none|open|missing|invalid|slow|open-error|create-error`.
 * 기본은 첫 실행(none)이다. 만들기/열기에 성공하면 이후 getCurrentCompany가 open을 돌려준다.
 */
export type CompanyScenario =
  'none' | 'open' | 'missing' | 'invalid' | 'slow' | 'open-error' | 'create-error'
const SCENARIOS: readonly CompanyScenario[] = [
  'none',
  'open',
  'missing',
  'invalid',
  'slow',
  'open-error',
  'create-error'
]

export function parseCompanyScenario(search: string): CompanyScenario {
  const v = new URLSearchParams(search).get('mock-company')
  return SCENARIOS.find((s) => s === v) ?? 'none'
}

type CompanyMockApi = Pick<
  WindowApi,
  'createCompany' | 'selectCompanyFolder' | 'openCompany' | 'getCurrentCompany'
>

export function createMockCompanyApi(scenario: CompanyScenario): CompanyMockApi {
  let opened: CompanyInfo | null = scenario === 'open' ? structuredClone(mockCompany) : null
  const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
  const infoFor = (dir: string): CompanyInfo => ({
    ...structuredClone(mockCompany),
    dir,
    name: dir.split('/').filter(Boolean).pop() ?? mockCompany.name
  })

  return {
    getCurrentCompany: async (): Promise<CompanyState> => {
      if (scenario === 'slow') await delay(2500)
      if (opened) return { status: 'open', company: structuredClone(opened) }
      if (scenario === 'missing') return { status: 'missing', name: 'my-company-cli' }
      if (scenario === 'invalid')
        return { status: 'invalid', name: 'my-company-cli', message: 'marker missing' }
      return { status: 'none' }
    },
    selectCompanyFolder: async (purpose) =>
      purpose === 'create-location' ? '/mock/Companies' : '/mock/Companies/Existing Co',
    createCompany: async (req) =>
      scenario === 'create-error'
        ? { ok: false, code: 'already-exists', message: 'mock' }
        : { ok: true, companyDir: `${req.path}/${req.name}` },
    openCompany: async (req) => {
      if (scenario === 'open-error') return { ok: false, code: 'not-company', message: 'mock' }
      opened = infoFor(req.path)
      return { ok: true, company: structuredClone(opened) }
    }
  }
}
