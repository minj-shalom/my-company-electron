import { describe, expect, it } from 'vitest'
import { initialPanelOpen, shouldCollapsePanel } from './panel-rules'

describe('shouldCollapsePanel', () => {
  it('collapses only on a real map -> org switch on narrow screens', () => {
    expect(shouldCollapsePanel('map', 'org', true)).toBe(true)
    expect(shouldCollapsePanel('org', 'org', true)).toBe(false)
    expect(shouldCollapsePanel('map', 'org', false)).toBe(false)
    expect(shouldCollapsePanel('org', 'map', true)).toBe(false)
  })
})

describe('initialPanelOpen', () => {
  it('starts folded on narrow screens only', () => {
    expect(initialPanelOpen(true)).toBe(false)
    expect(initialPanelOpen(false)).toBe(true)
  })
})
