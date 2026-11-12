import { app, BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { createMainWindow } from './window'
import { registerIpcHandlers } from './ipc'
import { checkSqlite } from './db'

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.mycompany.app')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  // 네이티브 모듈 로드 실패를 시작 시점에 드러낸다.
  checkSqlite()
  registerIpcHandlers()
  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
