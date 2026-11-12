/** AI CLI 제공자 감지/연결 테스트 결과 타입 (main/preload/renderer 공용). */

/** 감지 대상 CLI. 고정 허용 목록이며 사용자 입력이 명령 이름이 되는 일은 없다. */
export const PROVIDER_CLI_IDS = ['claude', 'codex', 'gemini'] as const
export type ProviderCliId = (typeof PROVIDER_CLI_IDS)[number]

export type DetectState =
  | 'ok' // 실행되었고 버전을 읽었다
  | 'not-installed' // 실행 파일을 찾지 못했다
  | 'exec-failed' // 찾았지만 실행에 실패했다 (권한, 비정상 종료 등)
  | 'timeout' // 시간 안에 응답하지 않았다 (첫 실행 지연 등)

/** message는 고정 문구다. 경로나 원본 오류 메시지를 담지 않는다. */
export interface ProviderDetection {
  provider: ProviderCliId
  state: DetectState
  /** `--version` 출력의 첫 줄. state가 ok일 때만 값이 있을 수 있다. */
  version: string | null
  message: string
}

export type ConnectionTestState = 'ok' | DetectState | 'failed' | 'unsupported'

/** 사용자가 누른 `연결 테스트`의 결과. CLI 출력 본문은 담지 않는다. */
export interface ConnectionTestResult {
  provider: ProviderCliId
  state: ConnectionTestState
  message: string
}

/** 주간 한도 단위. 지금은 달러 예산만 쓴다. 단위를 늘릴 때 이 유니온과 검증을 함께 갱신한다. */
export type WeeklyLimitUnit = 'usd'

export const WEEKLY_LIMIT_MAX = 100_000

/** 예산 기준 값이다. 토큰/인증 정보를 담는 필드는 없다. */
export interface WeeklyLimit {
  provider: ProviderCliId
  amount: number
  unit: WeeklyLimitUnit
}

/** 전체 교체 저장. main은 provider 중복, 허용 목록, 금액을 validateWeeklyLimitAmount로 검증한다. */
export interface WeeklyLimitsSaveRequest {
  limits: WeeklyLimit[]
}

/** 0보다 크고 WEEKLY_LIMIT_MAX 이하인 유한한 수, 소수점 둘째 자리까지. main과 renderer가 같은 규칙을 쓴다. */
export function validateWeeklyLimitAmount(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= WEEKLY_LIMIT_MAX &&
    Math.abs(value * 100 - Math.round(value * 100)) < 1e-6
  )
}
