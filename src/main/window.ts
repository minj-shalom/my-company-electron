import { BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { isAllowedAppUrl, isAllowedExternalUrl } from './external-url'

// webPreferences는 보안 리뷰 대상이므로 이 한 곳에서만 만든다.
const WEB_PREFERENCES = {
  preload: join(__dirname, '../preload/index.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true
} as const

const DEV_URL = is.dev ? process.env['ELECTRON_RENDERER_URL'] : undefined

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    webPreferences: WEB_PREFERENCES
  })

  win.on('ready-to-show', () => win.show())

  // 새 창은 모두 막고, 외부 링크는 https와 호스트 허용 목록만 시스템 브라우저로 넘긴다.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  const guardNavigation = (event: { preventDefault: () => void }, url: string): void => {
    if (!isAllowedAppUrl(url, DEV_URL)) event.preventDefault()
  }
  win.webContents.on('will-navigate', guardNavigation)
  // 서버 리다이렉트로도 허용 범위를 벗어나지 못하게 같은 규칙을 건다.
  win.webContents.on('will-redirect', guardNavigation)

  if (DEV_URL) {
    void win.loadURL(DEV_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}
