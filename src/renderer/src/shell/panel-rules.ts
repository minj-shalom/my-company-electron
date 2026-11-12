/** 맵에서 조직도로 실제 전환될 때만, 좁은 화면이면 하단 시트를 접는다. 이미 조직도에 있거나 넓은 화면이면 사용자가 연 패널을 건드리지 않는다. */
export function shouldCollapsePanel(prevView: string, nextView: string, narrow: boolean): boolean {
  return narrow && prevView !== 'org' && nextView === 'org'
}
