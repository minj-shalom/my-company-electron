import { describe, expect, it } from 'vitest'
import {
  THEME_STORAGE_KEY,
  parsePreference,
  readPreference,
  resolveTheme,
  writePreference
} from './theme'

describe('theme preference', () => {
  it('accepts only known values and falls back to system', () => {
    expect(parsePreference('dark')).toBe('dark')
    expect(parsePreference('light')).toBe('light')
    expect(parsePreference('<script>')).toBe('system')
    expect(parsePreference(null)).toBe('system')
    expect(parsePreference(42)).toBe('system')
  })

  it('resolves system by the OS setting and explicit values as-is', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it('reads a stored value', () => {
    expect(readPreference({ getItem: (k) => (k === THEME_STORAGE_KEY ? 'light' : null) })).toBe(
      'light'
    )
  })

  it('does not throw when storage is missing or throws', () => {
    expect(readPreference(null)).toBe('system')
    expect(
      readPreference({
        getItem: () => {
          throw new Error('denied')
        }
      })
    ).toBe('system')
    expect(writePreference(null, 'dark')).toBe(false)
    expect(
      writePreference(
        {
          setItem: () => {
            throw new Error('quota')
          }
        },
        'dark'
      )
    ).toBe(false)
  })

  it('writes the preference', () => {
    const data: Record<string, string> = {}
    expect(writePreference({ setItem: (k, v) => void (data[k] = v) }, 'dark')).toBe(true)
    expect(data[THEME_STORAGE_KEY]).toBe('dark')
  })
})
