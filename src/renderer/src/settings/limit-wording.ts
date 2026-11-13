import type { ProviderCliId, WeeklyLimitUnit } from '../../../shared/provider'

/**
 * 한도 단위와 요금제 문구 (D-016). 화면 어디서든 이 상수만 쓴다. 단위가 바뀌면 여기만 고친다.
 * 요금제는 앱이 인증 정보를 읽지 못해 자동으로 알 수 없으므로 사용자가 직접 고른다.
 */
export const PLAN_LABELS: Record<WeeklyLimitUnit, string> = {
  'subscription-percent': '구독제',
  usd: '종량제(API)'
}

export const PLAN_HELP: Record<WeeklyLimitUnit, string> = {
  'subscription-percent':
    '구독 사용률(%)로 보여 줘요. 구독 한도는 앱이 알 수 없어서, 아래에 적은 기준값 대비 추정치예요.',
  usd: '쓴 금액을 달러와 원화로 함께 보여 줘요.'
}

export const AMOUNT_LABELS: Record<WeeklyLimitUnit, string> = {
  'subscription-percent': '기준값 (달러로 환산한 주간 금액)',
  usd: '주간 예산 (달러)'
}

export const PROVIDER_NAMES: Record<ProviderCliId, string> = {
  claude: 'Claude',
  codex: 'ChatGPT (Codex)',
  gemini: 'Gemini'
}

export const UNKNOWN_TEXT = '알 수 없음'
export const COMPANY_COMMON_TEXT = '회사 공통'
export const UNCLASSIFIED_TEXT = '미분류'
export const AMOUNT_RULE_HINT =
  '금액 숫자만 입력하세요. 토큰, 비밀번호, API 키는 입력하지 마세요. 비워 두면 한도 없음이에요.'
export const CONNECTION_TEST_WARNING =
  '연결 테스트는 AI를 실제로 한 번 호출해서 사용량이 조금 쓰일 수 있어요. 필요할 때만 눌러 주세요.'
