/**
 * 사무실 에셋 접근 모듈. 바닥, 책상, 아바타, 상태 표식을 만드는 코드가 모두 여기에 있다.
 * 지금은 이미지 파일 없이 PixiJS Graphics로 픽셀을 그린다 (라이선스 확인이 끝난 CC0 팩이 없어서).
 * 나중에 스프라이트 시트로 바꿀 때는 이 파일의 export만 같은 모양으로 유지하면 레이아웃/상태 로직은 그대로다.
 */
import { Container, Graphics, Text } from 'pixi.js'
import type { AvatarStatus } from '../../../shared/office'
import type { BadgeView } from '../assign/assign-model'
import { lookFor, shortLabel } from './avatar-look'
import { ROOM_HEADER, SLOT_H, type RoomLayout } from './layout'
import type { Palette } from './palette'

/** 스프라이트 한 픽셀이 월드에서 차지하는 크기. */
const PX = 4
const AVATAR_W = 10
const AVATAR_TOP = 22
const BOB = 3

/**
 * 아바타 도안 (10x14). h 머리카락, s 피부, e 눈, b 옷(부서 색), d 바지, k 신발.
 * 긴 머리는 같은 도안 위에 머리카락 칸을 더 칠한다.
 */
const BODY = [
  '...hhhh...',
  '..hhhhhh..',
  '..hssssh..',
  '..sesses..',
  '..ssssss..',
  '...ssss...',
  '..bbbbbb..',
  '.bbbbbbbb.',
  '.sbbbbbbs.',
  '.sbbbbbbs.',
  '..bbbbbb..',
  '..dd..dd..',
  '..dd..dd..',
  '..kk..kk..'
] as const
const LONG_HAIR = [
  [2, 3],
  [7, 3],
  [2, 4],
  [7, 4],
  [2, 5],
  [7, 5]
] as const

const TEXT_RESOLUTION = 4
const LABEL_SIZE = 12
const MARK_W = 26
const MARK_H = 18

export function createRoomFloor(room: RoomLayout, deptColor: number, p: Palette): Graphics {
  const g = new Graphics()
  // 블러 없는 단색 그림자 (UI 패널과 같은 규칙).
  g.rect(room.x + 4, room.y + 4, room.w, room.h).fill(p['shadow-color'])
  g.rect(room.x, room.y, room.w, room.h).fill(p['floor-a'])
  const tile = 32
  for (let ty = 0; ty * tile < room.h - ROOM_HEADER; ty += 1) {
    for (let tx = 0; tx * tile < room.w; tx += 1) {
      if ((tx + ty) % 2 === 0) continue
      const w = Math.min(tile, room.w - tx * tile)
      const h = Math.min(tile, room.h - ROOM_HEADER - ty * tile)
      g.rect(room.x + tx * tile, room.y + ROOM_HEADER + ty * tile, w, h).fill(p['floor-b'])
    }
  }
  g.rect(room.x, room.y, room.w, ROOM_HEADER).fill(p['bg-panel'])
  g.rect(room.x, room.y + ROOM_HEADER - 4, room.w, 4).fill(deptColor)
  g.rect(room.x, room.y, room.w, room.h).stroke({
    width: 3,
    color: p['border-strong'],
    alignment: 1
  })
  return g
}

export function createRoomTitle(room: RoomLayout, fontFamily: string, p: Palette): Text {
  const t = new Text({
    text: shortLabel(room.name, 14),
    style: { fontFamily, fontSize: 14, fontWeight: '700', fill: p.text }
  })
  t.resolution = TEXT_RESOLUTION
  t.position.set(room.x + 10, room.y + 5)
  return t
}

export interface AvatarParts {
  /** 자리 전체. 원점은 자리의 위쪽 가운데. */
  root: Container
  /** 위아래로 움직이는 몸. */
  body: Container
  /** 상태 표식(말풍선). */
  mark: Graphics
  /** 선택 표시. */
  ring: Graphics
  /** 프로젝트 소속 배지 줄 (T-045). */
  badges: Container
}

export function createAvatar(
  title: string,
  bodyColor: number,
  fontFamily: string,
  p: Palette
): AvatarParts {
  const root = new Container()
  const ring = new Graphics()
  ring
    .rect(-34, AVATAR_TOP - 4, 68, SLOT_H - AVATAR_TOP - 4)
    .fill({ color: p['bg-panel'], alpha: 0.55 })
    .stroke({ width: 3, color: p.focus, alignment: 1 })
  ring.visible = false

  const look = lookFor(title)
  const colors: Record<string, number> = {
    h: p[`hair-${look.hair}`],
    s: p[`skin-${look.skin}`],
    e: p['shadow-color'],
    b: bodyColor,
    d: p['border-strong'],
    k: p['shadow-color']
  }
  const sprite = new Graphics()
  const left = -(AVATAR_W * PX) / 2
  const cells: [number, number, number][] = []
  BODY.forEach((row, y) => {
    for (let x = 0; x < AVATAR_W; x += 1) {
      const c = row[x]
      if (c !== '.') cells.push([x, y, colors[c]])
    }
  })
  if (look.style === 1) for (const [x, y] of LONG_HAIR) cells.push([x, y, colors.h])
  for (const [x, y, color] of cells) sprite.rect(left + x * PX, y * PX, PX, PX).fill(color)

  const body = new Container()
  body.position.y = AVATAR_TOP
  body.addChild(sprite)

  const desk = new Graphics()
  const deskTop = AVATAR_TOP + 9 * PX
  desk
    .rect(-30, deskTop, 60, 16)
    .fill(p['office-desk'])
    .stroke({ width: 2, color: p['shadow-color'] })
  // 노트북: 책상 오른쪽 끝에 두어 아바타를 가리지 않는다.
  desk
    .rect(16, deskTop - 8, 11, 8)
    .fill(p['bg-inset'])
    .stroke({ width: 2, color: p['shadow-color'] })

  const label = new Text({
    text: shortLabel(title),
    style: { fontFamily, fontSize: LABEL_SIZE, fontWeight: '700', fill: p.text }
  })
  label.resolution = TEXT_RESOLUTION
  label.anchor.set(0.5, 0)
  label.position.set(0, deskTop + 20)
  const pill = new Graphics()
  const pw = label.width + 10
  pill
    .rect(-pw / 2, deskTop + 18, pw, LABEL_SIZE + 6)
    .fill({ color: p['bg-panel'], alpha: 0.92 })
    .stroke({ width: 1, color: p.border })

  const mark = new Graphics()
  mark.position.set(0, 0)

  const badges = new Container()
  root.addChild(ring, body, desk, pill, label, mark, badges)
  return { root, body, mark, ring, badges }
}

/** 작업 중에는 몸이 한 픽셀 칸만큼 위아래로 움직인다. `frame`이 null이면 제자리. */
export function poseBody(parts: AvatarParts, status: AvatarStatus, frame: number | null): void {
  const up = status === 'working' && frame !== null && frame % 2 === 1
  parts.body.position.y = AVATAR_TOP - (up ? BOB : 0)
}

/**
 * 상태 표식을 다시 그린다. 모양으로도 구분한다: 대기 = zz, 작업 중 = 점 셋, 승인 대기 = 느낌표.
 * `frame`이 null이면 움직임 없는 정지 모습(대기, 또는 움직임 줄이기 설정)이다.
 */
export function drawMark(
  g: Graphics,
  status: AvatarStatus,
  frame: number | null,
  p: Palette
): void {
  g.clear()
  const color =
    status === 'working' ? p.working : status === 'awaiting-approval' ? p.warn : p['text-muted']
  const lift = status === 'awaiting-approval' && frame !== null && frame % 2 === 1 ? -2 : 0
  const x = -MARK_W / 2
  const y = 1 + lift
  g.rect(x, y, MARK_W, MARK_H).fill(p['bg-panel']).stroke({ width: 2, color })
  g.rect(-2, y + MARK_H, 4, 3).fill(color) // 말풍선 꼬리
  if (status === 'idle') {
    // z 모양: 위 막대, 대각, 아래 막대
    g.rect(-5, y + 4, 8, 2).fill(color)
    g.rect(0, y + 6, 2, 2).fill(color)
    g.rect(-2, y + 8, 2, 2).fill(color)
    g.rect(-5, y + 10, 8, 2).fill(color)
  } else if (status === 'working') {
    const active = frame === null ? -1 : frame % 3
    for (let i = 0; i < 3; i += 1) {
      g.rect(-8 + i * 6, y + 7 - (i === active ? 3 : 0), 4, 4).fill(color)
    }
  } else {
    g.rect(-2, y + 3, 4, 7).fill(color)
    g.rect(-2, y + 12, 4, 3).fill(color)
  }
}

export function setRingVisible(parts: AvatarParts, visible: boolean): void {
  parts.ring.visible = visible
}

/** 프로젝트 색 토큰. 색은 보조이고 이니셜 글자와 목록의 이름이 구분을 맡는다. */
const PROJECT_TOKENS = ['focus', 'working', 'warn', 'dept-plan', 'dept-rnd'] as const
const BADGE_W = 12
const BADGE_H = 13
const BADGE_GAP = 2

/** 이름표 아래에 PM 글자 라벨, 프로젝트 이니셜(최대 3개), "+N"을 가운데 정렬로 그린다. */
export function drawBadges(
  parts: AvatarParts,
  view: BadgeView | undefined,
  fontFamily: string,
  p: Palette
): void {
  for (const c of parts.badges.removeChildren()) c.destroy({ children: true })
  if (!view || (view.items.length === 0 && !view.pm)) return
  const y = AVATAR_TOP + 9 * PX + 18 + LABEL_SIZE + 8
  const text = (value: string, size: number): Text => {
    const t = new Text({
      text: value,
      style: { fontFamily, fontSize: size, fontWeight: '700', fill: p.text }
    })
    t.resolution = TEXT_RESOLUTION
    return t
  }
  const cells: { w: number; draw: (x: number) => void }[] = []
  if (view.pm) {
    const label = text('PM', 9)
    const w = Math.ceil(label.width) + 6
    cells.push({
      w,
      draw: (x) => {
        const g = new Graphics()
        g.rect(x, y, w, BADGE_H).fill(p['bg-inset']).stroke({ width: 2, color: p['border-strong'] })
        label.position.set(x + 3, y + 2)
        parts.badges.addChild(g, label)
      }
    })
  }
  for (const item of view.items) {
    cells.push({
      w: BADGE_W,
      draw: (x) => {
        const g = new Graphics()
        g.rect(x, y, BADGE_W, BADGE_H)
          .fill(p['bg-panel'])
          .stroke({ width: 2, color: p[PROJECT_TOKENS[item.colorIndex % PROJECT_TOKENS.length]] })
        const t = text(item.initial, 9)
        t.anchor.set(0.5, 0)
        t.position.set(x + BADGE_W / 2, y + 2)
        parts.badges.addChild(g, t)
      }
    })
  }
  if (view.extra > 0) {
    const t = text(`+${view.extra}`, 9)
    cells.push({
      w: Math.ceil(t.width),
      draw: (x) => {
        t.position.set(x, y + 2)
        parts.badges.addChild(t)
      }
    })
  }
  const total = cells.reduce((s, c) => s + c.w, 0) + BADGE_GAP * (cells.length - 1)
  let x = -total / 2
  for (const c of cells) {
    c.draw(x)
    x += c.w + BADGE_GAP
  }
}

/** 강조 필터에서 제외된 직원은 흐리게 한다. */
export function setDimmed(parts: AvatarParts, dimmed: boolean): void {
  parts.root.alpha = dimmed ? 0.3 : 1
}
