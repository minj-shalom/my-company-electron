/** 앱 전역 테마 설정 (T-038). 허용 목록 값만 저장한다. */
export const THEME_PREFERENCES = ['system', 'light', 'dark'] as const
export type ThemePreference = (typeof THEME_PREFERENCES)[number]
export const THEME_DEFAULT: ThemePreference = 'system'

export function isThemePreference(v: unknown): v is ThemePreference {
  return typeof v === 'string' && (THEME_PREFERENCES as readonly string[]).includes(v)
}
