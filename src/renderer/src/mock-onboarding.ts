import {
  PROVIDER_CLI_IDS,
  validateWeeklyLimitAmount,
  type ConnectionTestResult,
  type DetectState,
  type ProviderCliId,
  type ProviderDetection,
  type WeeklyLimit
} from '../../shared/provider'
import type { ApiResult } from '../../shared/result'

/**
 * 브라우저 mock 전용. "다시 확인"을 누를 때마다 상태가 바뀌어 모든 화면 상태(설치됨/미설치/실행 실패/응답 없음)를 볼 수 있다.
 * 호출 횟수별 시퀀스의 마지막 값이 계속 유지된다.
 */
const DETECT_SEQUENCE: Record<ProviderCliId, readonly DetectState[]> = {
  claude: ['ok'],
  codex: ['not-installed', 'exec-failed', 'ok'],
  gemini: ['timeout', 'not-installed', 'ok']
}

const DETECT_MESSAGES: Record<DetectState, string> = {
  ok: '설치되어 있습니다.',
  'not-installed': 'CLI를 찾을 수 없습니다.',
  'exec-failed': 'CLI 실행에 실패했습니다.',
  timeout: '시간 안에 응답하지 않았습니다.'
}

let detectCalls = 0
let limits: WeeklyLimit[] = []

export function resetMockOnboarding(): void {
  detectCalls = 0
  limits = []
}

export async function mockDetectProviders(): Promise<ApiResult<ProviderDetection[]>> {
  const n = detectCalls++
  return {
    ok: true,
    value: PROVIDER_CLI_IDS.map((provider) => {
      const seq = DETECT_SEQUENCE[provider]
      const state = seq[Math.min(n, seq.length - 1)]
      return {
        provider,
        state,
        version: state === 'ok' ? '1.0.0 (mock)' : null,
        message: DETECT_MESSAGES[state]
      }
    })
  }
}

export async function mockTestConnection(
  provider: ProviderCliId
): Promise<ApiResult<ConnectionTestResult>> {
  if (!PROVIDER_CLI_IDS.includes(provider)) {
    return { ok: false, code: 'invalid-request', message: '알 수 없는 제공자입니다.' }
  }
  // 실제 main과 같게 Claude만 지원한다.
  return provider === 'claude'
    ? { ok: true, value: { provider, state: 'ok', message: '연결되었습니다.' } }
    : {
        ok: true,
        value: {
          provider,
          state: 'unsupported',
          message: '이 제공자의 연결 테스트는 아직 지원하지 않습니다.'
        }
      }
}

export async function mockGetWeeklyLimits(): Promise<ApiResult<WeeklyLimit[]>> {
  return { ok: true, value: structuredClone(limits) }
}

export async function mockSaveWeeklyLimits(req: {
  limits: WeeklyLimit[]
}): Promise<ApiResult<WeeklyLimit[]>> {
  const seen = new Set<ProviderCliId>()
  for (const l of req.limits) {
    if (
      !PROVIDER_CLI_IDS.includes(l.provider) ||
      seen.has(l.provider) ||
      l.unit !== 'usd' ||
      !validateWeeklyLimitAmount(l.amount)
    ) {
      return { ok: false, code: 'invalid-request', message: '한도 값이 올바르지 않습니다.' }
    }
    seen.add(l.provider)
  }
  limits = structuredClone(req.limits)
  return { ok: true, value: structuredClone(limits) }
}
