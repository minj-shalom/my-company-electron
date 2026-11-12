import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { setOfficeStatusSource } from './office/status'
import {
  applyTheme,
  getBrowserStorage,
  readPreference,
  resolveTheme,
  systemPrefersDark
} from './theme'

async function bootstrap(): Promise<void> {
  // 첫 페인트 전에 테마를 적용해 라이트/다크 깜빡임을 막는다.
  applyTheme(resolveTheme(readPreference(getBrowserStorage()), systemPrefersDark()))
  // Electron 밖(브라우저 dev)에서만 mock 주입. import.meta.env.DEV 분기라 프로덕션 번들에서 제거된다.
  if (import.meta.env.DEV && !window.api) {
    const { mockApi } = await import('./mock-api')
    window.api = mockApi
    // 실제 실행 이벤트가 연결되기 전까지 사무실 아바타 상태를 순환시킨다 (개발 전용).
    const { mockOfficeStatus } = await import('./office/mock-status')
    setOfficeStatusSource(mockOfficeStatus)
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}

void bootstrap()
