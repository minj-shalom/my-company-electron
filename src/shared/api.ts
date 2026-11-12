/** main/preload/renderer 공용 `window.api` 계약. 채널을 추가하면 여기와 preload를 함께 갱신한다. */
export interface WindowApi {
  /** IPC 왕복 확인용. main이 'pong'을 돌려준다. */
  ping: () => Promise<string>
}

/** IPC 채널명 (`도메인:동작`). */
export const IPC_CHANNELS = {
  ping: 'app:ping'
} as const
