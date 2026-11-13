import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('theme store', () => {
  beforeEach(() => {
    vi.resetModules()
    const dataset: Record<string, string> = {}
    vi.stubGlobal('document', { documentElement: { dataset } })
    vi.stubGlobal('window', { localStorage: undefined })
  })

  it('applies the saved preference at startup and ignores invalid values', async () => {
    const store = await import('./theme-store')
    await store.initTheme({ getTheme: async () => ({ ok: true, value: 'light' }) })
    expect(store.getThemePreference()).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    await store.initTheme({ getTheme: async () => ({ ok: true, value: '<x>' as never }) })
    expect(store.getThemePreference()).toBe('system')
  })

  it('keeps the cached value when loading fails', async () => {
    const store = await import('./theme-store')
    await store.chooseTheme('dark', { saveTheme: async (t) => ({ ok: true, value: t }) })
    await store.initTheme({ getTheme: async () => ({ ok: false, code: 'internal', message: '' }) })
    expect(store.getThemePreference()).toBe('dark')
  })

  it('applies immediately and reports save failures', async () => {
    const store = await import('./theme-store')
    const seen: string[] = []
    store.subscribeTheme(() => seen.push(store.getThemePreference()))
    const ok = await store.chooseTheme('dark', {
      saveTheme: async () => ({ ok: false, code: 'internal', message: '' })
    })
    expect(ok).toBe(false)
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(seen).toEqual(['dark'])
    const thrown = await store.chooseTheme('light', {
      saveTheme: async () => {
        throw new Error('x')
      }
    })
    expect(thrown).toBe(false)
  })
})
