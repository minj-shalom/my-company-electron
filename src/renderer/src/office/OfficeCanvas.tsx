import { useEffect, useRef, useState } from 'react'
import type { BadgeView } from '../assign/assign-model'
import type { OfficeStatusMap } from '../../../shared/office'
import { Button } from '../ui/Button'
import type { OfficeLayout } from './layout'
import { readPalette, readPixelFontFamily } from './palette'
import type { OfficeScene } from './scene'

interface Props {
  layout: OfficeLayout
  statuses: OfficeStatusMap
  selected: string | null
  onSelect: (title: string) => void
  /** 직급별 프로젝트 배지와 강조할 직급(null이면 모두 강조). */
  badges?: ReadonlyMap<string, BadgeView>
  highlight?: ReadonlySet<string> | null
  /** 렌더러를 만들지 못했을 때 (예: WebGL/canvas 모두 불가). 목록은 그대로 쓸 수 있다. */
  onUnavailable?: () => void
}

const EMPTY_BADGES: ReadonlyMap<string, BadgeView> = new Map()

type CanvasState = 'starting' | 'ready' | 'failed'

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'
const prefersReducedMotion = (): boolean =>
  typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_MOTION_QUERY).matches

/**
 * PixiJS 캔버스 한 장과 확대/이동 버튼. 장면(scene)은 마운트 때 만들고 언마운트 때 destroy한다.
 * 캔버스는 마우스/터치용이고, 같은 정보(직원, 상태, 선택)는 옆의 직원 목록에서 키보드로 쓸 수 있다.
 */
export function OfficeCanvas({
  layout,
  statuses,
  selected,
  onSelect,
  badges,
  highlight = null,
  onUnavailable
}: Props): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const [scene, setScene] = useState<OfficeScene | null>(null)
  const [state, setState] = useState<CanvasState>('starting')
  const [backend, setBackend] = useState<string>('')
  // 장면 생성 뒤의 첫 배치/상태/선택은 아래 효과들이 채운다. 콜백은 ref로 들고 있어 장면을 다시 만들지 않는다.
  const onSelectRef = useRef(onSelect)
  const onUnavailableRef = useRef(onUnavailable)
  useEffect(() => {
    onSelectRef.current = onSelect
    onUnavailableRef.current = onUnavailable
  })

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let disposed = false
    let created: OfficeScene | null = null
    void (async () => {
      try {
        // 글꼴이 준비되기 전에 Text를 만들면 대체 글꼴로 굳는다.
        const family = readPixelFontFamily()
        await document.fonts?.load(`700 12px "${family}"`).catch(() => undefined)
        const { OfficeScene: SceneClass } = await import('./scene')
        if (disposed) return
        const s = await SceneClass.create(host, {
          palette: readPalette(),
          fontFamily: family,
          reducedMotion: prefersReducedMotion(),
          onSelect: (t) => onSelectRef.current(t)
        })
        if (disposed) {
          s.destroy()
          return
        }
        created = s
        setBackend(s.backend)
        setScene(s)
        setState('ready')
      } catch {
        if (!disposed) {
          setState('failed')
          onUnavailableRef.current?.()
        }
      }
    })()
    return () => {
      disposed = true
      created?.destroy()
      setScene(null)
    }
  }, [])

  useEffect(() => scene?.setLayout(layout), [scene, layout])
  useEffect(() => scene?.setStatuses(statuses), [scene, statuses])
  useEffect(() => scene?.setSelected(selected, true), [scene, selected])
  useEffect(() => scene?.setProjects(badges ?? EMPTY_BADGES, highlight), [scene, badges, highlight])

  // 테마가 바뀌면 data-theme 속성이 바뀐다. 캔버스 색은 CSS 변수에서 다시 읽는다.
  useEffect(() => {
    if (!scene) return
    const observer = new MutationObserver(() => scene.setPalette(readPalette()))
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    })
    return () => observer.disconnect()
  }, [scene])

  useEffect(() => {
    if (!scene || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia(REDUCED_MOTION_QUERY)
    const onChange = (): void => scene.setReducedMotion(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [scene])

  return (
    <div className="office-stage" data-state={state} data-backend={backend || undefined}>
      <div
        ref={hostRef}
        className="office-stage__host"
        role="img"
        aria-label="가상 사무실 지도. 같은 내용을 아래 직원 목록에서 키보드로 볼 수 있어요."
      />
      {state === 'starting' && (
        <p className="office-stage__note" role="status">
          사무실을 준비하고 있어요…
        </p>
      )}
      {state === 'failed' && (
        <p className="office-stage__note error" role="alert">
          이 환경에서는 사무실 지도를 그릴 수 없어요. 아래 직원 목록은 그대로 쓸 수 있어요.
        </p>
      )}
      {state === 'ready' && (
        <div className="office-stage__controls" role="group" aria-label="지도 보기">
          <Button size="small" aria-label="확대" onClick={() => scene?.zoomBy(1)}>
            +
          </Button>
          <Button size="small" aria-label="축소" onClick={() => scene?.zoomBy(-1)}>
            -
          </Button>
          <Button size="small" onClick={() => scene?.fit()}>
            전체 보기
          </Button>
        </div>
      )}
    </div>
  )
}
