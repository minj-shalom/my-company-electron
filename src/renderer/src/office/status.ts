import type { AvatarStatus, OfficeStatusMap, OfficeStatusSource } from '../../../shared/office'

export const STATUS_LABEL: Record<AvatarStatus, string> = {
  idle: '대기',
  working: '작업 중',
  'awaiting-approval': '승인 대기'
}

export function statusOf(map: OfficeStatusMap, title: string): AvatarStatus {
  return Object.hasOwn(map, title) ? map[title] : 'idle'
}

/** 움직임이 필요한 상태인지. 대기는 정지 표식만 쓴다. */
export function isAnimated(status: AvatarStatus): boolean {
  return status !== 'idle'
}

export function countByStatus(
  titles: readonly string[],
  map: OfficeStatusMap
): Record<AvatarStatus, number> {
  const counts: Record<AvatarStatus, number> = { idle: 0, working: 0, 'awaiting-approval': 0 }
  for (const t of titles) counts[statusOf(map, t)] += 1
  return counts
}

/** 두 상태 맵이 직원 목록 기준으로 같은지. 같으면 화면을 다시 그리지 않는다. */
export function sameStatuses(
  titles: readonly string[],
  a: OfficeStatusMap,
  b: OfficeStatusMap
): boolean {
  return titles.every((t) => statusOf(a, t) === statusOf(b, t))
}

/**
 * 실제 공급자가 연결되기 전의 기본값. 모두 대기로 보낸다.
 * 실행 이벤트/티켓/결재 상태를 합치는 공급자가 생기면 `setOfficeStatusSource`로 교체한다.
 */
const idleSource: OfficeStatusSource = {
  subscribe: (titles, onChange) => {
    onChange(Object.fromEntries(titles.map((t) => [t, 'idle' as const])))
    return () => {}
  }
}

let source: OfficeStatusSource = idleSource

export function getOfficeStatusSource(): OfficeStatusSource {
  return source
}

export function setOfficeStatusSource(next: OfficeStatusSource): void {
  source = next
}

/** 실제(또는 개발용) 공급자가 연결됐는지. 기본 공급자면 false라서 화면이 "연동 전"을 알린다. */
export function hasLiveStatusSource(): boolean {
  return source !== idleSource
}
