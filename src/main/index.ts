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
import { registerUsageHandlers } from './usage/usage-ipc'
import { registerThemeHandlers } from './settings/theme-ipc'
import { usageRecorder, usageServiceFor } from './usage/usage-runtime'
import { ClaudeAdapter } from './providers/claude/claude-adapter'
import { createProviderAdapter, providerSelectionFor } from './providers/provider-selection-ipc'
import type { ProviderAdapter } from './providers/types'
import { Scheduler } from './scheduler/scheduler'
import { createLastRunStore } from './scheduler/last-run-store'
import { companyBoundDeps } from './scheduler/scheduler-wiring'
import { registerSchedulerHandlers } from './scheduler/scheduler-ipc'
import { createTickRunner, type TickShared } from './tick/tick-runner'
import { tickDepsFor } from './tick/tick-wiring'
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
    const usageDeps = { context: companyContext, userDataDir: app.getPath('userData') }
    const providerService = new ProviderService()
    providers = providerService
    registerDomainHandlers({
      context: companyContext,
      providers: providerService,
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
    // run:start는 직원·티켓을 알 수 없으므로 귀속은 미분류/회사 공통이다.
    runner = new ClaudeAdapter({
      cwd: process.cwd(),
      onUsage: usageRecorder(usageDeps, 'claude', {})
    })
    registerRunHandlers(runner)
    registerUsageHandlers(usageDeps)
    registerThemeHandlers(app.getPath('userData'))
    // 스케줄러는 열린 회사 1개만 다룬다. 틱은 회사에 묶인 입력으로 틱마다 새로 만들고, 한도 카드 쿨다운만 공유한다.
    // 한도 점검은 CFO 사용량 집계(T-019)에 연결되어 있고, 점검이 실패하면 틱은 실행하지 않는다 (가장 보수적).
    const tickShared: TickShared = { lastLimitCardAt: 0 }
    const sched = new Scheduler({
      ...companyBoundDeps(companyContext, app.getPath('userData')),
      lastRuns: createLastRunStore(app.getPath('userData')),
      tick: async (ctx) => {
        if (companyContext.getOpenCompany() === null) return
        // 설정과 감지 결과를 틱 시작 때 한 번 고정한다: 변경은 다음 틱부터 적용되고 진행 중인 틱은 그대로다.
        const selection = await providerSelectionFor({
          context: companyContext,
          providers: providerService
        }).snapshot()
        const deps = tickDepsFor({
          context: companyContext,
          userDataDir: app.getPath('userData'),
          checkLimit: (employeeIds) =>
            usageServiceFor(usageDeps).checkLimit([
              ...new Set(
                (employeeIds.length > 0 ? employeeIds : [undefined]).map((id) => {
                  const r = selection.resolve(id)
                  return r.ok ? r.provider : 'claude'
                })
              )
            ]),
          // 쓸 수 있는 제공자가 없으면 claude 어댑터가 시작 때 cli-not-found로 거부한다 (안내 문구는 기존 실패 경로).
          createAdapter: (cwd, employeeId, run) => {
            const r = selection.resolve(employeeId)
            const provider = r.ok ? r.provider : 'claude'
            return createProviderAdapter(
              provider,
              cwd,
              // 직원 귀속은 이 실행을 맡긴 직원이다. 모르면 null(미분류)로 둔다.
              usageRecorder(usageDeps, provider, {
                employee: employeeId ?? null,
                ticket: run?.ticketId ?? null,
                project: run?.projectId ?? null
              })
            )
          }
        })
        await createTickRunner(deps, tickShared)(ctx)
      }
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
