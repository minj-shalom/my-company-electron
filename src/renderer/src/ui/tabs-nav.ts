/** 가로 탭 목록의 키보드 이동. 좌우 화살표는 순환하고 Home/End는 처음/끝으로 간다. 해당 없는 키는 null. */
export function nextTabIndex(key: string, current: number, count: number): number | null {
  if (count <= 0) return null
  switch (key) {
    case 'ArrowRight':
      return (current + 1) % count
    case 'ArrowLeft':
      return (current - 1 + count) % count
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return null
  }
}
