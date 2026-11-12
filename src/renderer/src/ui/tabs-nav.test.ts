import { describe, expect, it } from 'vitest'
import { nextTabIndex } from './tabs-nav'

describe('nextTabIndex', () => {
  it('wraps with arrow keys', () => {
    expect(nextTabIndex('ArrowRight', 2, 3)).toBe(0)
    expect(nextTabIndex('ArrowLeft', 0, 3)).toBe(2)
    expect(nextTabIndex('ArrowDown', 0, 3)).toBeNull()
    expect(nextTabIndex('ArrowUp', 1, 3)).toBeNull()
  })
  it('jumps with Home/End', () => {
    expect(nextTabIndex('Home', 2, 3)).toBe(0)
    expect(nextTabIndex('End', 0, 3)).toBe(2)
  })
  it('ignores other keys and empty lists', () => {
    expect(nextTabIndex('Enter', 0, 3)).toBeNull()
    expect(nextTabIndex('ArrowRight', 0, 0)).toBeNull()
  })
})
