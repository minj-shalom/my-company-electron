import { useSyncExternalStore } from 'react'
import { chooseTheme, getThemePreference, subscribeTheme } from './theme-store'
import type { ThemePreference } from './theme'

/** 선택(시스템/라이트/다크)을 즉시 적용·저장한다. 반환값 Promise<boolean>은 저장 성공 여부. */
export function useTheme(): {
  preference: ThemePreference
  setPreference: (p: ThemePreference) => Promise<boolean>
} {
  const preference = useSyncExternalStore(subscribeTheme, getThemePreference, getThemePreference)
  return { preference, setPreference: (p) => chooseTheme(p) }
}
