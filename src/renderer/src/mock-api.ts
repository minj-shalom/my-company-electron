import type { WindowApi } from '../../shared/api'

/** 브라우저 개발 모드 전용 mock. 동적 import로만 쓰이고 프로덕션에서는 dead code로 제거된다. */
export const mockApi: WindowApi = {
  ping: async () => 'pong (mock)',
  startRun: async () => ({ ok: false, code: 'cli-not-found', message: 'mock: runner unavailable' }),
  cancelRun: async () => false,
  onRunEvent: () => () => {}
}
