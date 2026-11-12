import type { IpcMainInvokeEvent } from 'electron'

/** 앱 자신의 페이지에서 온 요청인지 origin으로 비교한다 (startsWith 접두어 비교는 우회될 수 있다). */
export function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const raw = event.senderFrame?.url
  if (!raw) return false
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  const dev = process.env['ELECTRON_RENDERER_URL']
  if (dev !== undefined) {
    try {
      return url.origin === new URL(dev).origin
    } catch {
      return false
    }
  }
  // 패키징된 앱은 file:// 로 로드한다. file URL의 origin은 불투명하므로 프로토콜로 확인한다.
  return url.protocol === 'file:'
}
