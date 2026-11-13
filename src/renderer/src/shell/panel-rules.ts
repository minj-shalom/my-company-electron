const FULL_WIDTH_VIEWS: readonly string[] = ['org', 'settings']

/** 맵에서 조직도·설정으로 실제 전환될 때만, 좁은 화면이면 하단 시트를 접는다. 이미 조직도에 있거나 넓은 화면이면 사용자가 연 패널을 건드리지 않는다. */
export function shouldCollapsePanel(prevView: string, nextView: string, narrow: boolean): boolean {
  return narrow && !FULL_WIDTH_VIEWS.includes(prevView) && FULL_WIDTH_VIEWS.includes(nextView)
}

/** 처음 열 때 하단 시트가 지도를 반 넘게 가리지 않도록, 좁은 화면에서는 패널을 접은 채 시작한다. */
export function initialPanelOpen(narrow: boolean): boolean {
  return !narrow
}
