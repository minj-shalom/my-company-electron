import { app, Menu, nativeImage, Tray } from 'electron'

// 16x16 단색 원. 별도 리소스 파일 없이 트레이 아이콘을 만든다 (정식 아이콘은 패키징 단계에서 교체).
const ICON_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAO0lEQVR4nGNgoAXwz/36HxumSDNRhhDSjNcQYjVjNYRUzRiGjBpABQMojkaqJCRiDcGrmZAhRGkmFQAABZ2jUAAciNsAAAAASUVORK5CYII='

export interface TrayActions {
  showWindow: () => void
  runNow: () => void
  quit: () => void
}

/** 트레이가 있으면 마지막 창을 닫아도 앱(과 스케줄러)이 계속 돈다. macOS는 기존대로 창 없이 유지한다. */
export function shouldQuitWhenAllWindowsClosed(platform: string, trayActive: boolean): boolean {
  return platform !== 'darwin' && !trayActive
}

export function createAppTray(actions: TrayActions): Tray {
  const tray = new Tray(nativeImage.createFromDataURL(`data:image/png;base64,${ICON_PNG_BASE64}`))
  tray.setToolTip(app.getName())
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '창 열기', click: actions.showWindow },
      { label: '지금 실행', click: actions.runNow },
      { type: 'separator' },
      { label: '종료', click: actions.quit }
    ])
  )
  tray.on('click', actions.showWindow)
  return tray
}
