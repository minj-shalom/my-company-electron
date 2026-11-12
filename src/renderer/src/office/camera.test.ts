import { describe, expect, it } from 'vitest'
import {
  MAX_FIT_SCALE,
  MAX_SCALE,
  MIN_FIT_SCALE,
  MIN_SCALE,
  clampCamera,
  fitCamera,
  panBy,
  screenToWorld,
  wheelFactor,
  zoomAt
} from './camera'

describe('fitCamera', () => {
  it('centers a small world without upscaling past the max', () => {
    const cam = fitCamera({ width: 200, height: 100 }, { width: 1000, height: 800 })
    expect(cam.scale).toBe(MAX_FIT_SCALE)
    expect(cam.x).toBeCloseTo((1000 - 200 * MAX_FIT_SCALE) / 2)
  })
  it('fits a medium world exactly', () => {
    const cam = fitCamera({ width: 1000, height: 500 }, { width: 500, height: 400 })
    expect(cam.scale).toBeCloseTo(0.5)
  })
  it('keeps text readable by not shrinking below the minimum fit scale', () => {
    const cam = fitCamera({ width: 4000, height: 3000 }, { width: 390, height: 320 })
    expect(cam.scale).toBe(MIN_FIT_SCALE)
  })
  it('falls back safely for empty sizes', () => {
    expect(fitCamera({ width: 0, height: 0 }, { width: 100, height: 100 })).toEqual({
      x: 0,
      y: 0,
      scale: 1
    })
  })
})

describe('zoomAt', () => {
  it('keeps the point under the cursor fixed', () => {
    const cam = { x: 30, y: -20, scale: 1 }
    const before = screenToWorld(cam, 200, 150)
    const next = zoomAt(cam, 1.5, 200, 150)
    const after = screenToWorld(next, 200, 150)
    expect(after.x).toBeCloseTo(before.x)
    expect(after.y).toBeCloseTo(before.y)
  })
  it('clamps the scale', () => {
    expect(zoomAt({ x: 0, y: 0, scale: 1 }, 100, 0, 0).scale).toBe(MAX_SCALE)
    expect(zoomAt({ x: 0, y: 0, scale: 1 }, 0.001, 0, 0).scale).toBe(MIN_SCALE)
  })
})

describe('clampCamera', () => {
  const world = { width: 2000, height: 1000 }
  const view = { width: 500, height: 400 }
  it('does not let the world drift away', () => {
    const far = clampCamera(panBy({ x: 0, y: 0, scale: 1 }, 5000, 5000), world, view)
    expect(far.x).toBeLessThanOrEqual(96)
    expect(far.y).toBeLessThanOrEqual(96)
    const other = clampCamera(panBy({ x: 0, y: 0, scale: 1 }, -9000, -9000), world, view)
    expect(other.x).toBeGreaterThanOrEqual(view.width - world.width - 96)
  })
  it('centers when the world fits', () => {
    const cam = clampCamera({ x: 999, y: 999, scale: 0.1 }, world, view)
    expect(cam.x).toBeCloseTo((500 - 200) / 2)
  })
})

describe('wheelFactor', () => {
  it('zooms in when scrolling up and is bounded', () => {
    expect(wheelFactor(-100)).toBeGreaterThan(1)
    expect(wheelFactor(100)).toBeLessThan(1)
    expect(wheelFactor(-100000)).toBeCloseTo(wheelFactor(-120))
  })
})
