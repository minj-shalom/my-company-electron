/** 제공자 선택 설정 (회사 기본 + 직원별 오버라이드) 타입. main/preload/renderer 공용. */
import { PROVIDER_CLI_IDS, type ProviderCliId } from './provider'

export const MAX_PROVIDER_OVERRIDES = 100
export const DEFAULT_PROVIDER: ProviderCliId = 'claude'

/** 값은 허용 목록 제공자뿐이다. 토큰·API 키 필드는 이 계약에 없다. */
export interface ProviderSelection {
  defaultProvider: ProviderCliId
  /** 직원 id → 제공자. 없는 직원은 회사 기본을 따른다. */
  overrides: Record<string, ProviderCliId>
}

export type ProviderNoticeCode =
  | 'fallback' // 선택한 제공자를 쓸 수 없어 다른 제공자로 대체했다
  | 'auto-disabled' // 도구 브리지 미지원이라 이 실행의 자동 모드가 꺼졌다 (매번 컨펌)

export interface ProviderNotice {
  code: ProviderNoticeCode
  message: string
}

export function isProviderCliIdValue(value: unknown): value is ProviderCliId {
  return typeof value === 'string' && (PROVIDER_CLI_IDS as readonly string[]).includes(value)
}
