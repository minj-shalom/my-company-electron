import type { ProviderSelection } from '../../shared/provider-selection'
import type { ProviderCliId } from '../../shared/provider'
import type { ApiResult } from '../../shared/result'
import { NoCompanyError, type CompanyContext } from '../company/company-context'
import { ClaudeAdapter } from './claude/claude-adapter'
import { CodexAdapter } from './codex/codex-adapter'
import { GeminiAdapter } from './gemini/gemini-adapter'
import type { ProviderService } from './provider-service'
import { ProviderSelectionService, createSelectionStore } from './provider-selection'
import type { ProviderAdapter } from './types'

export interface ProviderSelectionDeps {
  context: CompanyContext
  providers: Pick<ProviderService, 'detect'>
}

/** 환경변수 허용 목록(CODEX_HOME, OPENAI_*, GEMINI_*)은 넘기지 않는다: 기본값(미전달)을 그대로 쓴다. */
export function createProviderAdapter(provider: ProviderCliId, cwd: string): ProviderAdapter {
  if (provider === 'codex') return new CodexAdapter({ cwd })
  if (provider === 'gemini') return new GeminiAdapter({ cwd })
  return new ClaudeAdapter({ cwd })
}

/** 열린 회사의 설정 파일을 쓰는 서비스. 회사가 바뀌면 다음 호출부터 새 회사를 본다. */
export function providerSelectionFor(deps: ProviderSelectionDeps): ProviderSelectionService {
  const { fs } = deps.context.requireOpenCompany()
  return new ProviderSelectionService({
    store: createSelectionStore(fs),
    detect: () => deps.providers.detect()
  })
}

export interface ProviderSelectionHandlers {
  getProviderSelection: () => Promise<ApiResult<ProviderSelection>>
  saveProviderSelection: (req: unknown) => Promise<ApiResult<ProviderSelection>>
}

export function createProviderSelectionHandlers(
  deps: ProviderSelectionDeps
): ProviderSelectionHandlers {
  const failure = (e: unknown): ApiResult<never> =>
    e instanceof NoCompanyError
      ? { ok: false, code: 'no-company', message: '열린 회사가 없습니다.' }
      : { ok: false, code: 'internal', message: '요청을 처리하지 못했습니다.' }
  return {
    getProviderSelection: async () => {
      try {
        return { ok: true, value: await providerSelectionFor(deps).get() }
      } catch (e) {
        return failure(e)
      }
    },
    saveProviderSelection: async (req) => {
      try {
        const saved = await providerSelectionFor(deps).save(req)
        if (saved === null)
          return {
            ok: false,
            code: 'invalid-request',
            message: '제공자 설정 값이 올바르지 않습니다.'
          }
        return { ok: true, value: saved }
      } catch (e) {
        return failure(e)
      }
    }
  }
}
