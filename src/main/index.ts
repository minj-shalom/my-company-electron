import { app, BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { createMainWindow } from './window'
import { registerIpcHandlers } from './ipc'
import { checkSqlite } from './db'
import { registerCompanyHandlers } from './company-ipc'
import { CompanyContext, createLastCompanyStore } from './company/company-context'
import { CompanyService } from './company/company-service'
import { registerRunHandlers } from './run-ipc'
import { ClaudeAdapter } from './providers/claude/claude-adapter'
import type { ProviderAdapter } from './providers/types'

let runner: ProviderAdapter | undefined

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.mycompany.app')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  // 네이티브 모듈 로드 실패를 시작 시점에 드러낸다.
  checkSqlite()
  registerIpcHandlers()
  // 열린 회사는 이 컨텍스트 하나다. 후속 핸들러(T-034 등)는 이것을 주입받아 SafeFs를 얻는다.
  const companyContext = new CompanyContext({
    store: createLastCompanyStore(app.getPath('userData'))
  })
  registerCompanyHandlers(new CompanyService({ context: companyContext }))
  // 창이 뜨기 전에 마지막 회사를 복원해 첫 company:current부터 최종 상태를 돌려준다.
  await companyContext.restoreLast()
  // 회사 폴더 설정은 후속 티켓에서 도입한다. 그 전까지는 앱 실행 디렉터리를 cwd로 쓴다.
  runner = new ClaudeAdapter({ cwd: process.cwd() })
  registerRunHandlers(runner)
  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => runner?.cancelAll())
