import {
  applyTheme,
  getBrowserStorage,
  parsePreference,
  readPreference,
  resolveTheme,
  systemPrefersDark,
  writePreference,
  type ThemePreference
} from './theme'

/**
 * 테마 선택의 단일 저장소. 원본은 앱 전역 설정(getTheme/saveTheme)이고, localStorage는
 * 첫 페인트 전에 깜빡임 없이 적용하기 위한 캐시일 뿐이다.
 */
let preference: ThemePreference = 'system'
let loadedFromStorage = false
const listeners = new Set<() => void>()
let watching = false

function ensureLoaded(): void {
  if (loadedFromStorage) return
  loadedFromStorage = true
  preference = readPreference(getBrowserStorage())
}

function apply(): void {
  applyTheme(resolveTheme(preference, systemPrefersDark()))
}

function watchSystem(): void {
  if (watching || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
  watching = true
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (preference === 'system') apply()
  })
}

function set(next: ThemePreference): void {
  preference = next
  writePreference(getBrowserStorage(), next)
  apply()
  for (const l of listeners) l()
}

export function getThemePreference(): ThemePreference {
  ensureLoaded()
  return preference
}

export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** 첫 페인트 전에 캐시된 선택을 적용한다. */
export function applyCachedTheme(): void {
  ensureLoaded()
  watchSystem()
  apply()
}

/** 앱 시작 시 한 번: 저장된 선택을 불러와 적용한다. 실패하면 캐시(또는 시스템) 값을 그대로 쓴다. */
export async function initTheme(api: Pick<Window['api'], 'getTheme'> = window.api): Promise<void> {
  ensureLoaded()
  watchSystem()
  apply()
  try {
    const r = await api.getTheme()
    if (r.ok) set(parsePreference(r.value))
  } catch {
    /* 저장된 선택을 못 읽어도 앱은 캐시 값으로 계속 쓴다. */
  }
}

/** 즉시 적용하고 저장한다. 저장에 실패하면 false (이번 실행에서만 유지된다). */
export async function chooseTheme(
  next: ThemePreference,
  api: Pick<Window['api'], 'saveTheme'> = window.api
): Promise<boolean> {
  ensureLoaded()
  watchSystem()
  set(next)
  try {
    return (await api.saveTheme(next)).ok
  } catch {
    return false
  }
}
