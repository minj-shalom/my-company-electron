/**
 * 사무실 레이아웃 계산 (순수 함수). 렌더러(PixiJS)와 무관하게 부서 목록만으로 방과 자리를 배치한다.
 * 규칙은 고정이다: 방은 부서 순서대로 한 줄에 `roomsPerRow(방 수)`개씩 놓고, 줄은 가운데 정렬한다.
 * 방 안의 자리는 왼쪽 위부터 `MAX_COLS`열까지 채운다. 부서/직원 수가 달라져도 같은 규칙으로 늘어난다.
 */
import type { DeptTone, DepartmentGroup } from '../org/org-view'

export const SLOT_W = 72
export const SLOT_H = 104
export const ROOM_PAD = 16
export const ROOM_HEADER = 28
export const ROOM_GAP = 32
export const MAP_MARGIN = 24
export const MAX_COLS = 4
/** 방 하나의 최소 폭. 직원이 1명이어도 부서 이름이 들어가야 한다. */
export const ROOM_MIN_W = 136

export interface OfficeGroup {
  name: string
  tone: DeptTone
  /** 소속 직원 직급 (표시 순서). */
  titles: readonly string[]
}

export function toOfficeGroups(groups: readonly DepartmentGroup[]): OfficeGroup[] {
  return groups.map((g) => ({ name: g.name, tone: g.tone, titles: g.members.map((m) => m.title) }))
}

export interface RoomLayout {
  index: number
  name: string
  tone: DeptTone
  x: number
  y: number
  w: number
  h: number
  /** 부서 칸이 `cols`열인 자리 배치. 자리 좌표는 `OfficeLayout.seats`에 있다. */
  cols: number
}

export interface SeatLayout {
  title: string
  room: number
  /** 자리(슬롯)의 가운데 x, 위쪽 y. */
  cx: number
  top: number
}

export interface OfficeLayout {
  rooms: RoomLayout[]
  seats: SeatLayout[]
  width: number
  height: number
}

/** 한 줄에 놓을 방 수. 정사각형에 가깝게 늘어나도록 올림 제곱근을 쓴다. */
export function roomsPerRow(roomCount: number): number {
  if (roomCount <= 0) return 1
  return Math.max(1, Math.ceil(Math.sqrt(roomCount)))
}

export function roomColumns(memberCount: number): number {
  return Math.max(1, Math.min(MAX_COLS, memberCount))
}

export function computeLayout(groups: readonly OfficeGroup[]): OfficeLayout {
  const perRow = roomsPerRow(groups.length)
  const sized = groups.map((g, index) => {
    const cols = roomColumns(g.titles.length)
    const rows = Math.max(1, Math.ceil(g.titles.length / cols))
    return {
      g,
      index,
      cols,
      w: Math.max(ROOM_MIN_W, cols * SLOT_W + ROOM_PAD * 2),
      h: ROOM_HEADER + rows * SLOT_H + ROOM_PAD * 2
    }
  })

  const lines: (typeof sized)[] = []
  for (let i = 0; i < sized.length; i += perRow) lines.push(sized.slice(i, i + perRow))
  const lineWidth = (line: typeof sized): number =>
    line.reduce((sum, r) => sum + r.w, 0) + ROOM_GAP * Math.max(0, line.length - 1)
  const inner = Math.max(0, ...lines.map(lineWidth))

  const rooms: RoomLayout[] = []
  const seats: SeatLayout[] = []
  let y = MAP_MARGIN
  for (const line of lines) {
    const lineH = Math.max(...line.map((r) => r.h))
    let x = MAP_MARGIN + (inner - lineWidth(line)) / 2
    for (const r of line) {
      // 같은 줄의 방은 높이를 맞춰 줄이 반듯하게 보이게 한다.
      rooms.push({
        index: r.index,
        name: r.g.name,
        tone: r.g.tone,
        x,
        y,
        w: r.w,
        h: lineH,
        cols: r.cols
      })
      const gridW = r.cols * SLOT_W
      r.g.titles.forEach((title, i) => {
        seats.push({
          title,
          room: r.index,
          cx: x + (r.w - gridW) / 2 + (i % r.cols) * SLOT_W + SLOT_W / 2,
          top: y + ROOM_HEADER + ROOM_PAD + Math.floor(i / r.cols) * SLOT_H
        })
      })
      x += r.w + ROOM_GAP
    }
    y += lineH + ROOM_GAP
  }

  const hasRooms = rooms.length > 0
  return {
    rooms,
    seats,
    width: hasRooms ? inner + MAP_MARGIN * 2 : 0,
    height: hasRooms ? y - ROOM_GAP + MAP_MARGIN : 0
  }
}

/** 월드 좌표에서 아바타(자리)를 찾는다. 겹치면 가장 가까운 자리. 없으면 null. */
export function hitSeat(layout: OfficeLayout, wx: number, wy: number): SeatLayout | null {
  let best: SeatLayout | null = null
  let bestDist = Infinity
  for (const s of layout.seats) {
    const dx = Math.abs(wx - s.cx)
    const dy = wy - s.top
    // 자리 폭의 가운데 56px, 말풍선부터 이름표까지 세로 범위.
    if (dx > 30 || dy < 0 || dy > SLOT_H - 4) continue
    const dist = dx * dx + (dy - SLOT_H / 2) ** 2
    if (dist < bestDist) {
      best = s
      bestDist = dist
    }
  }
  return best
}
