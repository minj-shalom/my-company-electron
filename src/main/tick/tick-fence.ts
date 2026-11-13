/** 본문 안의 가장 긴 백틱 연속보다 긴 펜스(최소 4개). 본문이 펜스를 닫고 지침 영역으로 탈출하지 못하게 한다. */
export function fenceFor(body: string): string {
  let longest = 0
  for (const m of body.matchAll(/`+/g)) longest = Math.max(longest, m[0].length)
  return '`'.repeat(Math.max(4, longest + 1))
}
