import { describe, expect, it } from 'vitest'
import { bodyBytes, isDirty, validateDraft } from './profile-model'

const base = { name: '회사', vision: 'v', mission: 'm', principles: 'p' }

describe('profile-model', () => {
  it('detects changes', () => {
    expect(isDirty(base, { ...base })).toBe(false)
    expect(isDirty(base, { ...base, mission: 'x' })).toBe(true)
  })
  it('validates name length and emptiness', () => {
    expect(validateDraft(base)).toBeNull()
    expect(validateDraft({ ...base, name: '  ' })?.field).toBe('name')
    expect(validateDraft({ ...base, name: 'a'.repeat(51) })?.field).toBe('name')
  })
  it('counts UTF-8 bytes of the body and rejects over 64KB', () => {
    expect(bodyBytes({ ...base, vision: '가' })).toBe(3 + 2)
    expect(validateDraft({ ...base, vision: '가'.repeat(22000) })?.field).toBe('body')
  })
})
