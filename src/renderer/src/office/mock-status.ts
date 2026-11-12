/**
 * 개발 모드 전용 상태 공급자. 직원마다 시작점이 다른 고정 순서로 대기/작업 중/승인 대기를 돌린다.
 * main.tsx가 `import.meta.env.DEV`일 때만 동적으로 불러오므로 프로덕션 번들에는 들어가지 않는다.
 */
import { type AvatarStatus, type OfficeStatusSource } from '../../../shared/office'
import { sameStatuses } from './status'

const PATTERN: readonly AvatarStatus[] = [
  'idle',
  'working',
  'working',
  'awaiting-approval',
  'idle',
  'working'
]
const TICKS_PER_STEP = 3
export const MOCK_TICK_MS = 1500

/** `index`번째 직원의 `tick` 시점 상태 (순수 함수). */
export function mockStatusAt(index: number, tick: number): AvatarStatus {
  return PATTERN[(Math.floor(tick / TICKS_PER_STEP) + index) % PATTERN.length]
}

export const mockOfficeStatus: OfficeStatusSource = {
  subscribe: (titles, onChange) => {
    let tick = 0
    let last = snapshot(titles, tick)
    onChange(last)
    const timer = setInterval(() => {
      tick += 1
      const next = snapshot(titles, tick)
      // 바뀐 것이 없으면 알리지 않아 화면이 불필요하게 다시 그려지지 않게 한다.
      if (sameStatuses(titles, last, next)) return
      last = next
      onChange(next)
    }, MOCK_TICK_MS)
    return () => clearInterval(timer)
  }
}

function snapshot(titles: readonly string[], tick: number): Record<string, AvatarStatus> {
  return Object.fromEntries(titles.map((t, i) => [t, mockStatusAt(i, tick)]))
}
