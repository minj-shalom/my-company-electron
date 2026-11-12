import { describe, expect, it } from 'vitest'
import { nextStep, prevStep, stepIndex } from './wizard-steps'

describe('wizard steps', () => {
  it('moves forward until limits and never reaches done via next', () => {
    expect(nextStep('welcome')).toBe('providers')
    expect(nextStep('providers')).toBe('limits')
    expect(nextStep('limits')).toBe('limits')
  })
  it('moves back and stops at the ends', () => {
    expect(prevStep('limits')).toBe('providers')
    expect(prevStep('welcome')).toBe('welcome')
    expect(prevStep('done')).toBe('done')
  })
  it('reports index', () => {
    expect(stepIndex('done')).toBe(3)
  })
})
