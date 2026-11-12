/** 시스템 브라우저로 넘겨도 되는 호스트 (정확히 일치). 새 링크가 필요하면 여기에 추가하고 리뷰한다. */
export const EXTERNAL_HOST_ALLOWLIST: readonly string[] = [
  // 온보딩 안내 링크(provider-guide)가 실제로 쓰는 호스트만 둔다.
  'code.claude.com',
  'github.com'
]

/** https, 기본 포트, 허용 목록 호스트(punycode로 정규화된 ASCII), 자격 증명 없음인 URL만 허용한다. */
export function isAllowedExternalUrl(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  return (
    url.protocol === 'https:' &&
    url.port === '' &&
    url.username === '' &&
    url.password === '' &&
    EXTERNAL_HOST_ALLOWLIST.includes(url.hostname)
  )
}

/** 앱 자신의 페이지인지 origin으로 비교한다 (startsWith는 `http://localhost:5173.evil.com`을 통과시킨다). */
export function isAllowedAppUrl(raw: string, devUrl: string | undefined): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (devUrl) {
    try {
      return url.origin === new URL(devUrl).origin
    } catch {
      return false
    }
  }
  return url.protocol === 'file:'
}
