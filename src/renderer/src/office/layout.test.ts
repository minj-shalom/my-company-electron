import { describe, expect, it } from 'vitest'
import {
  MAP_MARGIN,
  ROOM_GAP,
  SLOT_H,
  computeLayout,
  hitSeat,
  roomsPerRow,
  type OfficeGroup
} from './layout'

const group = (name: string, n: number): OfficeGroup => ({
  name,
  tone: 'exec',
  titles: Array.from({ length: n }, (_, i) => `${name}-${i}`)
})
const groups = (sizes: number[]): OfficeGroup[] => sizes.map((n, i) => group(`D${i}`, n))

function overlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number }
): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

describe('roomsPerRow', () => {
  it.each([
    [0, 1],
    [1, 1],
    [2, 2],
    [5, 3],
    [6, 3],
    [10, 4],
    [20, 5]
  ])('%i rooms -> %i per row', (rooms, perRow) => {
    expect(roomsPerRow(rooms)).toBe(perRow)
  })
})

describe('computeLayout', () => {
  it('is empty for no departments', () => {
    expect(computeLayout([])).toEqual({ rooms: [], seats: [], width: 0, height: 0 })
  })

  it.each([[[1]], [[2, 3, 2, 3, 4]], [[2, 3, 2, 3, 6, 4]], [Array.from({ length: 12 }, () => 5)]])(
    'places every member once and rooms never overlap (%j)',
    (sizes) => {
      const input = groups(sizes)
      const layout = computeLayout(input)
      const titles = layout.seats.map((s) => s.title)
      expect(new Set(titles).size).toBe(titles.length)
      expect(titles).toHaveLength(sizes.reduce((a, b) => a + b, 0))
      for (let i = 0; i < layout.rooms.length; i += 1) {
        for (let j = i + 1; j < layout.rooms.length; j += 1) {
          expect(overlap(layout.rooms[i], layout.rooms[j])).toBe(false)
        }
      }
      for (const r of layout.rooms) {
        expect(r.x).toBeGreaterThanOrEqual(MAP_MARGIN)
        expect(r.x + r.w).toBeLessThanOrEqual(layout.width - MAP_MARGIN + 0.001)
        expect(r.y + r.h).toBeLessThanOrEqual(layout.height - MAP_MARGIN + 0.001)
      }
    }
  )

  it('keeps seats inside their own room', () => {
    const layout = computeLayout(groups([2, 3, 2, 3, 6, 4]))
    for (const s of layout.seats) {
      const r = layout.rooms[s.room]
      expect(s.cx).toBeGreaterThan(r.x)
      expect(s.cx).toBeLessThan(r.x + r.w)
      expect(s.top).toBeGreaterThanOrEqual(r.y)
      expect(s.top + SLOT_H).toBeLessThanOrEqual(r.y + r.h)
    }
  })

  it('keeps department order and rows aligned in height', () => {
    const layout = computeLayout(groups([1, 6, 2, 1, 1]))
    expect(layout.rooms.map((r) => r.name)).toEqual(['D0', 'D1', 'D2', 'D3', 'D4'])
    expect(layout.rooms[0].h).toBe(layout.rooms[1].h)
    expect(layout.rooms[3].y).toBeGreaterThanOrEqual(
      layout.rooms[0].y + layout.rooms[0].h + ROOM_GAP
    )
  })

  it('does not break on a department without members', () => {
    const layout = computeLayout(groups([0, 2]))
    expect(layout.rooms).toHaveLength(2)
    expect(layout.seats).toHaveLength(2)
  })

  it('is deterministic', () => {
    expect(computeLayout(groups([2, 3, 4]))).toEqual(computeLayout(groups([2, 3, 4])))
  })
})

describe('hitSeat', () => {
  const layout = computeLayout(groups([2, 2]))
  it('finds the seat under a point and ignores empty floor', () => {
    const s = layout.seats[1]
    expect(hitSeat(layout, s.cx, s.top + SLOT_H / 2)?.title).toBe(s.title)
    expect(hitSeat(layout, s.cx + 36, s.top + 10)).toBeNull()
    expect(hitSeat(layout, s.cx, s.top - 5)).toBeNull()
  })
})
