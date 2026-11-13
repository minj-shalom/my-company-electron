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

/**
 * 주간 한도 단위 (D-016). 요금제 종류는 앱이 인증 정보를 읽지 못하므로 사용자가 고르며, 그 선택이 이 단위다.
 * - `usd`: 종량제(API). amount는 달러 예산이고 한화는 사용자 입력 환율로 환산해 함께 보여 준다.
 * - `subscription-percent`: 구독제. 구독 한도는 앱이 알 수 없으므로 amount는 사용자가 입력한 기준값(달러 환산 금액)이고,
 *   사용률(%)은 그 기준값 대비 추정치다. 요청 수·토큰 수는 단위와 무관한 별도 지표다.
 */
export const WEEKLY_LIMIT_UNITS = ['usd', 'subscription-percent'] as const
export type WeeklyLimitUnit = (typeof WEEKLY_LIMIT_UNITS)[number]

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

/** 0.01 이상 WEEKLY_LIMIT_MAX 이하인 유한한 수, 소수점 둘째 자리까지. main과 renderer가 같은 규칙을 쓴다. */
export function validateWeeklyLimitAmount(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0.01 - 1e-9 && // 0.01 미만의 극소값(5e-324 등)은 센트 단위 검사를 우연히 통과하므로 하한을 둔다
    value <= WEEKLY_LIMIT_MAX &&
    Math.abs(value * 100 - Math.round(value * 100)) < 1e-6
  )
}
