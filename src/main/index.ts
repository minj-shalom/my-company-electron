import { app, BrowserWindow, type Tray } from 'electron'
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
import { Scheduler } from './scheduler/scheduler'
import { createLastRunStore } from './scheduler/last-run-store'
import { companyBoundDeps } from './scheduler/scheduler-wiring'
import { registerSchedulerHandlers } from './scheduler/scheduler-ipc'
import { createAppTray, shouldQuitWhenAllWindowsClosed } from './scheduler/tray'

const RESTORE_TIMEOUT_MS = 5000

let runner: ProviderAdapter | undefined
let providers: ProviderService | undefined
let scheduler: Scheduler | undefined
let tray: Tray | undefined

function showMainWindow(): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) createMainWindow()
  else {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }
}

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
    // 스케줄러는 열린 회사 1개만 다룬다. 실제 틱 내용(COO 틱)은 T-016이 tick을 채운다.
    // 그 전까지는 아무것도 하지 않는 틱이라 푸시·머지·발행 경로가 연결되지 않는다.
    const sched = new Scheduler({
      ...companyBoundDeps(companyContext, app.getPath('userData')),
      lastRuns: createLastRunStore(app.getPath('userData')),
      tick: async () => undefined
    })
    scheduler = sched
    registerSchedulerHandlers(sched)
    tray = createAppTray({
      showWindow: showMainWindow,
      runNow: () => void sched.runNow().catch(() => undefined),
      quit: () => app.quit()
    })
    createMainWindow()
    void sched.start()

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
  // 트레이가 있으면 창을 닫아도 백그라운드 스케줄러가 계속 돈다. 종료는 트레이 메뉴의 '종료'로 한다.
  if (shouldQuitWhenAllWindowsClosed(process.platform, tray !== undefined)) app.quit()
})

app.on('before-quit', () => {
  scheduler?.stop()
  tray?.destroy()
  runner?.cancelAll()
  providers?.shutdown()
})
