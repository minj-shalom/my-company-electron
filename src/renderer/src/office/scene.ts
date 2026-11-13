/**
 * PixiJS 사무실 장면. React와는 `OfficeCanvas`만 이 클래스를 안다.
 * - 렌더링은 필요할 때만 한다 (ticker를 돌리지 않는다). 변화가 있으면 rAF 한 번에 묶어 그린다.
 * - 움직임(작업 중/승인 대기)은 280ms 간격 타이머 하나로 구동하고, 움직일 직원이 없거나
 *   `prefers-reduced-motion`이거나 탭이 숨겨져 있으면 타이머를 끈다.
 * - destroy()는 타이머, 관찰자, 이벤트 리스너, PixiJS 리소스(텍스처, GL 컨텍스트)를 모두 해제한다.
 */
// 기본 PixiJS는 셰이더/유니폼 동기화에 new Function(unsafe-eval)을 요구한다. 이 가져오기는
// eval 없는 구현으로 바꿔 주므로 CSP(script-src 'self')를 완화하지 않아도 된다.
import 'pixi.js/unsafe-eval'
import { Application, Container, EventsTicker, Ticker } from 'pixi.js'
import type { AvatarStatus, OfficeStatusMap } from '../../../shared/office'
import {
  clampCamera,
  fitCamera,
  panBy,
  screenToWorld,
  wheelFactor,
  zoomAt,
  type Camera
} from './camera'
import type { BadgeView } from '../assign/assign-model'
import { hitSeat, type OfficeLayout } from './layout'
import type { Palette } from './palette'
import {
  createAvatar,
  createRoomFloor,
  createRoomTitle,
  drawBadges,
  drawMark,
  poseBody,
  setDimmed,
  setRingVisible,
  type AvatarParts
} from './sprites'
import { isAnimated, statusOf } from './status'

export type SceneBackend = 'webgl' | 'canvas'

export interface SceneOptions {
  palette: Palette
  fontFamily: string
  reducedMotion: boolean
  onSelect: (title: string) => void
}

interface AvatarEntry {
  parts: AvatarParts
  status: AvatarStatus
}

const FRAME_MS = 280
const DRAG_THRESHOLD = 4
const ZOOM_STEP = 1.25

const DEPT_KEYS = ['dept-exec', 'dept-rnd', 'dept-fin', 'dept-plan'] as const
const TONE_KEY = { exec: 0, rnd: 1, fin: 2, plan: 3 } as const

export class OfficeScene {
  readonly backend: SceneBackend
  private readonly app: Application
  private readonly host: HTMLElement
  private readonly canvas: HTMLCanvasElement
  private readonly world = new Container()
  private readonly avatars = new Map<string, AvatarEntry>()
  private layout: OfficeLayout = { rooms: [], seats: [], width: 0, height: 0 }
  private layoutKey = ''
  private statuses: OfficeStatusMap = {}
  private selected: string | null = null
  private badges: ReadonlyMap<string, BadgeView> = new Map()
  private highlight: ReadonlySet<string> | null = null
  private palette: Palette
  private readonly fontFamily: string
  private reducedMotion: boolean
  private readonly onSelect: (title: string) => void
  private camera: Camera = { x: 0, y: 0, scale: 1 }
  private userMovedCamera = false
  private frame = 0
  private timer: ReturnType<typeof setInterval> | null = null
  private raf = 0
  private destroyed = false
  private readonly resizeObserver: ResizeObserver
  private drag: {
    id: number
    startX: number
    startY: number
    lastX: number
    lastY: number
    moved: boolean
  } | null = null

  private constructor(
    app: Application,
    host: HTMLElement,
    opts: SceneOptions,
    backend: SceneBackend
  ) {
    this.app = app
    this.host = host
    this.canvas = app.canvas
    this.backend = backend
    this.palette = opts.palette
    this.fontFamily = opts.fontFamily
    this.reducedMotion = opts.reducedMotion
    this.onSelect = opts.onSelect

    app.stage.addChild(this.world)
    this.canvas.style.touchAction = 'none'
    this.canvas.addEventListener('pointerdown', this.onPointerDown)
    this.canvas.addEventListener('pointermove', this.onPointerMove)
    this.canvas.addEventListener('pointerup', this.onPointerUp)
    this.canvas.addEventListener('pointercancel', this.onPointerCancel)
    this.canvas.addEventListener('lostpointercapture', this.onPointerCancel)
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false })
    document.addEventListener('visibilitychange', this.syncTimer)
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(host)
  }

  /** 렌더러를 만든다. WebGL이 안 되면 canvas 렌더러로 내려간다 (webgpu는 쓰지 않는다). */
  static async create(host: HTMLElement, opts: SceneOptions): Promise<OfficeScene> {
    const app = new Application()
    const { width, height } = sizeOf(host)
    try {
      await app.init({
        preference: ['webgl', 'canvas'],
        width,
        height,
        background: opts.palette['bg-app'],
        antialias: false,
        autoDensity: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
        autoStart: false,
        sharedTicker: false
      })
      app.ticker.stop()
      // PixiJS 이벤트 시스템은 시스템 ticker로 매 프레임 가짜 pointermove를 만든다 (60fps rAF 낭비).
      // 클릭/드래그/휠은 아래에서 직접 처리하므로 그 ticker 연결을 끊는다.
      EventsTicker.removeTickerListener()
      // 렌더러의 SchedulerSystem(텍스처 GC 예약)도 시스템 ticker를 60fps로 돌린다. 이 장면은 장면을 다시 만들 때
      // 자원을 직접 destroy하고 정적이라 예약 작업이 필요 없으므로 멈춘다. 마운트마다 다시 시작되므로 그때마다 멈춘다.
      Ticker.system.stop()
      host.appendChild(app.canvas)
      const backend: SceneBackend = app.renderer.name === 'canvas' ? 'canvas' : 'webgl'
      return new OfficeScene(app, host, opts, backend)
    } catch (error) {
      // 일부만 만들어진 렌더러(GL 컨텍스트 포함)를 남기지 않는다. 원인은 호출한 쪽이 안내 문구로 처리한다.
      try {
        app.destroy({ removeView: true }, { children: true, texture: true, context: true })
      } catch {
        // 초기화 전에 실패하면 destroy가 다시 던질 수 있다. 원래 오류만 전달한다.
      }
      throw error
    }
  }

  setLayout(layout: OfficeLayout): void {
    // 내용이 같으면 다시 만들지 않는다 (사용자가 옮긴 팬/줌을 유지).
    const key = JSON.stringify(layout)
    if (key === this.layoutKey) return
    this.layoutKey = key
    this.layout = layout
    this.rebuild()
    this.userMovedCamera = false
    this.fit()
  }

  /** 프로젝트 배지(직급별)와 강조 필터(null이면 모두 강조). */
  setProjects(badges: ReadonlyMap<string, BadgeView>, highlight: ReadonlySet<string> | null): void {
    this.badges = badges
    this.highlight = highlight
    this.applyProjects()
    this.requestRender()
  }

  private applyProjects(): void {
    for (const [title, entry] of this.avatars) {
      drawBadges(entry.parts, this.badges.get(title), this.fontFamily, this.palette)
      setDimmed(entry.parts, this.highlight !== null && !this.highlight.has(title))
    }
  }

  setPalette(palette: Palette): void {
    this.palette = palette
    this.app.renderer.background.color = palette['bg-app']
    this.rebuild()
  }

  setStatuses(statuses: OfficeStatusMap): void {
    this.statuses = statuses
    for (const [title, entry] of this.avatars) {
      const next = statusOf(statuses, title)
      if (next === entry.status) continue
      entry.status = next
      this.paintAvatar(entry)
    }
    this.syncTimer()
    this.requestRender()
  }

  setSelected(title: string | null, reveal = false): void {
    this.selected = title
    for (const [t, entry] of this.avatars) setRingVisible(entry.parts, t === title)
    if (reveal && title) this.revealSeat(title)
    this.requestRender()
  }

  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced
    this.frame = 0
    for (const entry of this.avatars.values()) this.paintAvatar(entry)
    this.syncTimer()
    this.requestRender()
  }

  zoomBy(direction: 1 | -1): void {
    const { width, height } = sizeOf(this.host)
    this.setCamera(
      zoomAt(this.camera, direction > 0 ? ZOOM_STEP : 1 / ZOOM_STEP, width / 2, height / 2)
    )
    this.userMovedCamera = true
  }

  fit(): void {
    this.userMovedCamera = false
    this.setCamera(fitCamera(this.layout, sizeOf(this.host)))
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.stopTimer()
    if (this.raf) cancelAnimationFrame(this.raf)
    this.resizeObserver.disconnect()
    document.removeEventListener('visibilitychange', this.syncTimer)
    this.canvas.removeEventListener('pointerdown', this.onPointerDown)
    this.canvas.removeEventListener('pointermove', this.onPointerMove)
    this.canvas.removeEventListener('pointerup', this.onPointerUp)
    this.canvas.removeEventListener('pointercancel', this.onPointerCancel)
    this.canvas.removeEventListener('lostpointercapture', this.onPointerCancel)
    this.canvas.removeEventListener('wheel', this.onWheel)
    this.avatars.clear()
    this.app.destroy(
      { removeView: true },
      { children: true, texture: true, textureSource: true, context: true }
    )
  }

  private rebuild(): void {
    for (const child of this.world.removeChildren()) child.destroy({ children: true })
    this.avatars.clear()
    const p = this.palette
    const toneColor = (tone: keyof typeof TONE_KEY): number => p[DEPT_KEYS[TONE_KEY[tone]]]
    const floors = new Container()
    const seats = new Container()
    for (const room of this.layout.rooms) {
      floors.addChild(createRoomFloor(room, toneColor(room.tone), p))
      floors.addChild(createRoomTitle(room, this.fontFamily, p))
    }
    const roomByIndex = new Map(this.layout.rooms.map((r) => [r.index, r]))
    for (const seat of this.layout.seats) {
      const room = roomByIndex.get(seat.room)
      const parts = createAvatar(seat.title, toneColor(room?.tone ?? 'exec'), this.fontFamily, p)
      parts.root.position.set(seat.cx, seat.top)
      seats.addChild(parts.root)
      const entry: AvatarEntry = { parts, status: statusOf(this.statuses, seat.title) }
      this.avatars.set(seat.title, entry)
      this.paintAvatar(entry)
      setRingVisible(parts, seat.title === this.selected)
    }
    this.world.addChild(floors, seats)
    this.applyProjects()
    this.syncTimer()
    this.requestRender()
  }

  private paintAvatar(entry: AvatarEntry): void {
    const animate = isAnimated(entry.status) && !this.reducedMotion
    const frame = animate ? this.frame : null
    drawMark(entry.parts.mark, entry.status, frame, this.palette)
    poseBody(entry.parts, entry.status, frame)
  }

  private hasAnimated(): boolean {
    for (const entry of this.avatars.values()) if (isAnimated(entry.status)) return true
    return false
  }

  private readonly syncTimer = (): void => {
    const want = !this.destroyed && !this.reducedMotion && !document.hidden && this.hasAnimated()
    if (want && this.timer === null) {
      this.timer = setInterval(this.tick, FRAME_MS)
    } else if (!want) {
      this.stopTimer()
    }
  }

  private stopTimer(): void {
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
  }

  private readonly tick = (): void => {
    this.frame += 1
    for (const entry of this.avatars.values()) {
      if (isAnimated(entry.status)) this.paintAvatar(entry)
    }
    this.requestRender()
  }

  private requestRender(): void {
    if (this.raf || this.destroyed) return
    this.raf = requestAnimationFrame(() => {
      this.raf = 0
      if (!this.destroyed) this.app.render()
    })
  }

  private setCamera(cam: Camera): void {
    this.camera = clampCamera(cam, this.layout, sizeOf(this.host))
    this.world.position.set(this.camera.x, this.camera.y)
    this.world.scale.set(this.camera.scale)
    this.requestRender()
  }

  private resize(): void {
    if (this.destroyed) return
    const { width, height } = sizeOf(this.host)
    this.app.renderer.resize(width, height)
    if (this.userMovedCamera) this.setCamera(this.camera)
    else this.fit()
  }

  /** 목록에서 고른 직원이 화면 밖이면 가운데로 옮긴다. */
  private revealSeat(title: string): void {
    const seat = this.layout.seats.find((s) => s.title === title)
    if (!seat) return
    const { width, height } = sizeOf(this.host)
    const sx = seat.cx * this.camera.scale + this.camera.x
    const sy = (seat.top + 48) * this.camera.scale + this.camera.y
    const margin = 40
    if (sx >= margin && sx <= width - margin && sy >= margin && sy <= height - margin) return
    this.userMovedCamera = true
    this.setCamera({
      ...this.camera,
      x: width / 2 - seat.cx * this.camera.scale,
      y: height / 2 - (seat.top + 48) * this.camera.scale
    })
  }

  private localPoint(e: MouseEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  private seatAt(e: MouseEvent): string | null {
    const p = this.localPoint(e)
    const w = screenToWorld(this.camera, p.x, p.y)
    return hitSeat(this.layout, w.x, w.y)?.title ?? null
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 || this.drag) return
    try {
      this.canvas.setPointerCapture(e.pointerId)
    } catch {
      // 이미 끝난 포인터이면 던질 수 있다. 캡처 없이도 드래그는 캔버스 안에서 동작한다.
    }
    this.drag = {
      id: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      moved: false
    }
  }

  private readonly onPointerMove = (e: PointerEvent): void => {
    const d = this.drag
    if (!d || d.id !== e.pointerId) {
      this.canvas.style.cursor = this.seatAt(e) ? 'pointer' : 'grab'
      return
    }
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < DRAG_THRESHOLD) return
    d.moved = true
    this.userMovedCamera = true
    this.canvas.style.cursor = 'grabbing'
    this.setCamera(panBy(this.camera, e.clientX - d.lastX, e.clientY - d.lastY))
    d.lastX = e.clientX
    d.lastY = e.clientY
  }

  private readonly onPointerUp = (e: PointerEvent): void => {
    const d = this.drag
    if (!d || d.id !== e.pointerId) return
    this.drag = null
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId)
    if (d.moved) return
    const title = this.seatAt(e)
    if (title) this.onSelect(title)
  }

  private readonly onPointerCancel = (e: PointerEvent): void => {
    if (this.drag?.id === e.pointerId) this.drag = null
  }

  private readonly onWheel = (e: WheelEvent): void => {
    // 지도 위에서는 휠을 확대/축소에 쓴다. 페이지 스크롤은 지도 바깥에서 한다.
    e.preventDefault()
    const p = this.localPoint(e)
    this.userMovedCamera = true
    this.setCamera(zoomAt(this.camera, wheelFactor(e.deltaY), p.x, p.y))
  }
}

function sizeOf(host: HTMLElement): { width: number; height: number } {
  return {
    width: Math.max(1, Math.floor(host.clientWidth)),
    height: Math.max(1, Math.floor(host.clientHeight))
  }
}
