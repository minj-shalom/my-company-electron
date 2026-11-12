import { useEffect, useState } from 'react'
import {
  applyTheme,
  getBrowserStorage,
  readPreference,
  resolveTheme,
  systemPrefersDark,
  writePreference,
  type ThemePreference
} from './theme'

/** 선택(시스템/라이트/다크)을 저장하고 data-theme에 반영한다. 시스템 설정이 바뀌면 따라간다. */
export function useTheme(): {
  preference: ThemePreference
  setPreference: (p: ThemePreference) => void
} {
  const [preference, setPreferenceState] = useState<ThemePreference>(() =>
    readPreference(getBrowserStorage())
  )
  const [systemDark, setSystemDark] = useState<boolean>(() => systemPrefersDark())

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e: MediaQueryListEvent): void => setSystemDark(e.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    applyTheme(resolveTheme(preference, systemDark))
  }, [preference, systemDark])

  const setPreference = (p: ThemePreference): void => {
    setPreferenceState(p)
    writePreference(getBrowserStorage(), p)
  }
  return { preference, setPreference }
}
