/** 사무실 카메라 계산 (순수 함수). 화면 좌표 = 월드 좌표 * scale + (x, y). */

export interface Camera {
  x: number
  y: number
  scale: number
}

export interface Size {
  width: number
  height: number
}

export const MIN_SCALE = 0.25
export const MAX_SCALE = 3
/** 처음 맞출 때 글자가 읽히는 최소 배율. 넘치는 부분은 드래그로 본다. */
export const MIN_FIT_SCALE = 0.5
export const MAX_FIT_SCALE = 1.5
/** 월드가 화면을 벗어나도 최소한 이만큼은 화면 안에 남긴다. */
const KEEP_VISIBLE = 96

/** 비유한수(NaN, Infinity)는 `lo`로 취급해 좌표가 망가지지 않게 한다. */
const clamp = (v: number, lo: number, hi: number): number =>
  Number.isFinite(v) ? Math.min(Math.max(v, lo), hi) : lo

export function clampScale(scale: number): number {
  return clamp(scale, MIN_SCALE, MAX_SCALE)
}

/** 월드가 화면보다 작으면 가운데, 크면 화면 가장자리에서 `KEEP_VISIBLE`px 이상 벗어나지 않게 맞춘다. */
export function clampCamera(cam: Camera, world: Size, view: Size): Camera {
  const axis = (pos: number, worldLen: number, viewLen: number): number => {
    const len = worldLen * cam.scale
    if (len <= viewLen) return (viewLen - len) / 2
    const keep = Math.min(KEEP_VISIBLE, viewLen / 2)
    return clamp(pos, viewLen - len - keep, keep)
  }
  return {
    scale: cam.scale,
    x: axis(cam.x, world.width, view.width),
    y: axis(cam.y, world.height, view.height)
  }
}

/** 월드 전체가 보이도록 맞춘다 (배율은 `MIN_FIT_SCALE`~`MAX_FIT_SCALE`). 넘치면 왼쪽 위 기준. */
export function fitCamera(world: Size, view: Size): Camera {
  if (world.width <= 0 || world.height <= 0 || view.width <= 0 || view.height <= 0) {
    return { x: 0, y: 0, scale: 1 }
  }
  const fit = Math.min(view.width / world.width, view.height / world.height)
  const scale = clamp(fit, MIN_FIT_SCALE, MAX_FIT_SCALE)
  const overflowX = world.width * scale > view.width
  const overflowY = world.height * scale > view.height
  return clampCamera(
    { scale, x: overflowX ? KEEP_VISIBLE / 4 : 0, y: overflowY ? KEEP_VISIBLE / 4 : 0 },
    world,
    view
  )
}

/** 화면 좌표 (px, py)가 가리키는 월드 지점이 그대로 있도록 배율을 곱한다. */
export function zoomAt(cam: Camera, factor: number, px: number, py: number): Camera {
  if (![factor, px, py].every(Number.isFinite) || factor <= 0) return cam
  const scale = clampScale(cam.scale * factor)
  const k = scale / cam.scale
  return { scale, x: px - (px - cam.x) * k, y: py - (py - cam.y) * k }
}

export function panBy(cam: Camera, dx: number, dy: number): Camera {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return cam
  return { ...cam, x: cam.x + dx, y: cam.y + dy }
}

export function screenToWorld(cam: Camera, sx: number, sy: number): { x: number; y: number } {
  return { x: (sx - cam.x) / cam.scale, y: (sy - cam.y) / cam.scale }
}

/** 마우스 휠 deltaY를 배율 계수로. 위로 굴리면 확대. 한 번에 크게 튀지 않도록 제한한다. */
export function wheelFactor(deltaY: number): number {
  if (!Number.isFinite(deltaY)) return 1
  return Math.exp(-clamp(deltaY, -120, 120) * 0.0015)
}

export const KEY_PAN_STEP = 64

export type MapKeyAction =
  { kind: 'pan'; dx: number; dy: number } | { kind: 'zoom'; direction: 1 | -1 } | { kind: 'fit' }

/**
 * 지도에 포커스가 있을 때의 키 동작. 방향키는 화면을 키 방향으로 보여 주도록 움직이고(콘텐츠는 반대로 이동),
 * +/-는 확대/축소, 0은 전체 보기. 수정키가 눌려 있으면 브라우저/OS 단축키이므로 무시한다.
 */
export function mapKeyAction(
  key: string,
  mods: { ctrl?: boolean; meta?: boolean; alt?: boolean } = {}
): MapKeyAction | null {
  if (mods.ctrl || mods.meta || mods.alt) return null
  switch (key) {
    case 'ArrowLeft':
      return { kind: 'pan', dx: KEY_PAN_STEP, dy: 0 }
    case 'ArrowRight':
      return { kind: 'pan', dx: -KEY_PAN_STEP, dy: 0 }
    case 'ArrowUp':
      return { kind: 'pan', dx: 0, dy: KEY_PAN_STEP }
    case 'ArrowDown':
      return { kind: 'pan', dx: 0, dy: -KEY_PAN_STEP }
    case '+':
    case '=':
      return { kind: 'zoom', direction: 1 }
    case '-':
    case '_':
      return { kind: 'zoom', direction: -1 }
    case '0':
      return { kind: 'fit' }
    default:
      return null
  }
}
