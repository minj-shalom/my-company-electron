export const THEME_PREFERENCES = ['system', 'light', 'dark'] as const
export type ThemePreference = (typeof THEME_PREFERENCES)[number]
export type ResolvedTheme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'mc.theme'
export const THEME_LABELS: Record<ThemePreference, string> = {
  system: '시스템',
  light: '라이트',
  dark: '다크'
}

type ReadableStorage = Pick<Storage, 'getItem'>
type WritableStorage = Pick<Storage, 'setItem'>

/** 저장소의 값은 신뢰하지 않는다. 허용 값이 아니면 시스템 설정을 따른다. */
export function parsePreference(value: unknown): ThemePreference {
  return THEME_PREFERENCES.find((p) => p === value) ?? 'system'
}

export function resolveTheme(pref: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
  if (pref === 'system') return systemPrefersDark ? 'dark' : 'light'
  return pref
}

/** localStorage 접근은 비활성화/권한 오류로 throw할 수 있어 항상 감싼다. */
export function readPreference(storage: ReadableStorage | null): ThemePreference {
  if (!storage) return 'system'
  try {
    return parsePreference(storage.getItem(THEME_STORAGE_KEY))
  } catch {
    return 'system'
  }
}

export function writePreference(storage: WritableStorage | null, pref: ThemePreference): boolean {
  if (!storage) return false
  try {
    storage.setItem(THEME_STORAGE_KEY, pref)
    return true
  } catch {
    return false
  }
}

export function getBrowserStorage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function systemPrefersDark(): boolean {
  return typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : true
}

export function applyTheme(theme: ResolvedTheme): void {
  document.documentElement.dataset.theme = theme
}
