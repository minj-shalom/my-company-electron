import { app, BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { createMainWindow } from './window'
import { registerIpcHandlers } from './ipc'
import { checkSqlite } from './db'
import { registerCompanyHandlers } from './company-ipc'
import { CompanyContext, createLastCompanyStore } from './company/company-context'
import { CompanyService } from './company/company-service'
import { registerDomainHandlers } from './domain-ipc'
import { ProviderService } from './providers/provider-service'
import { createWeeklyLimitsStore } from './settings/weekly-limits-store'
import { registerRunHandlers } from './run-ipc'
import { ClaudeAdapter } from './providers/claude/claude-adapter'
import type { ProviderAdapter } from './providers/types'

const RESTORE_TIMEOUT_MS = 5000

let runner: ProviderAdapter | undefined
let providers: ProviderService | undefined

app
  .whenReady()
  .then(async () => {
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
    providers = new ProviderService()
    registerDomainHandlers({
      context: companyContext,
      providers,
      limits: createWeeklyLimitsStore(app.getPath('userData')),
      userDataDir: app.getPath('userData')
    })
    // 창이 뜨기 전에 마지막 회사를 복원해 첫 company:current부터 최종 상태를 돌려준다.
    // 느린 디스크(네트워크 드라이브 등)가 창 표시를 막지 않도록 기다리는 시간에 상한을 둔다.
    // 시간이 지나면 복원은 백그라운드에서 이어지고, renderer는 company:current를 다시 물으면 된다.
    await Promise.race([
      companyContext.restoreLast(),
      new Promise<void>((resolve) => setTimeout(resolve, RESTORE_TIMEOUT_MS).unref())
    ])
    // 회사 폴더 설정은 후속 티켓에서 도입한다. 그 전까지는 앱 실행 디렉터리를 cwd로 쓴다.
    runner = new ClaudeAdapter({ cwd: process.cwd() })
    registerRunHandlers(runner)
    createMainWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })
  .catch((e: unknown) => {
    // 시작 실패를 조용히 삼키면 창 없는 프로세스만 남는다. 원인 종류만 남기고 종료한다.
    console.error('App startup failed:', e instanceof Error ? e.name : 'unknown error')
    app.exit(1)
  })

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  runner?.cancelAll()
  providers?.shutdown()
})
