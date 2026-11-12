import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

async function bootstrap(): Promise<void> {
  // Electron 밖(브라우저 dev)에서만 mock 주입. import.meta.env.DEV 분기라 프로덕션 번들에서 제거된다.
  if (import.meta.env.DEV && !window.api) {
    const { mockApi } = await import('./mock-api')
    window.api = mockApi
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}

void bootstrap()
