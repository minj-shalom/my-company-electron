/** 시스템 브라우저로 넘겨도 되는 호스트 (정확히 일치). 새 링크가 필요하면 여기에 추가하고 리뷰한다. */
export const EXTERNAL_HOST_ALLOWLIST: readonly string[] = [
  'claude.ai',
  'claude.com',
  'docs.claude.com',
  'code.claude.com',
  'anthropic.com',
  'docs.anthropic.com',
  'github.com'
]

/** https이고 허용 목록 호스트이며 자격 증명(user:pass@)이 없는 URL만 허용한다. */
export function isAllowedExternalUrl(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  return (
    url.protocol === 'https:' &&
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
