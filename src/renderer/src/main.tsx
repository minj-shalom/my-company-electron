import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { setOfficeStatusSource } from './office/status'
import { applyCachedTheme, initTheme } from './theme-store'

async function bootstrap(): Promise<void> {
  // 첫 페인트 전에 캐시된 테마를 적용해 라이트/다크 깜빡임을 막는다. 저장된 값은 api 준비 뒤에 읽는다.
  applyCachedTheme()
  // Electron 밖(브라우저 dev)에서만 mock 주입. import.meta.env.DEV 분기라 프로덕션 번들에서 제거된다.
  if (import.meta.env.DEV && !window.api) {
    const { mockApi } = await import('./mock-api')
    window.api = mockApi
    // 기본은 mock 티켓/결재함에서 상태를 만든다. `?mock-office=cycle`이면 상태를 순환시킨다 (개발 전용).
    if (new URLSearchParams(location.search).get('mock-office') === 'cycle') {
      const { mockOfficeStatus } = await import('./office/mock-status')
      setOfficeStatusSource(mockOfficeStatus)
    }
  }
  await initTheme()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}

void bootstrap()
