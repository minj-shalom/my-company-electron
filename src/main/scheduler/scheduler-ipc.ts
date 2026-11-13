import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { IPC_CHANNELS } from '../../shared/api'
import type { SchedulerRunNowResult, SchedulerStatus } from '../../shared/scheduler'
import type { ApiResult } from '../../shared/result'
import { isTrustedSender } from '../ipc-guard'
import type { Scheduler } from './scheduler'

export interface SchedulerHandlers {
  getSchedulerStatus: () => Promise<ApiResult<SchedulerStatus>>
  runSchedulerNow: () => Promise<ApiResult<SchedulerRunNowResult>>
}

/** 입력이 없는 채널이라 검증할 본문은 없다. 상태 조회와 지금 실행만 열고, 스케줄 파일 쓰기 채널은 만들지 않는다. */
export function createSchedulerHandlers(scheduler: Scheduler): SchedulerHandlers {
  return {
    getSchedulerStatus: async () => ({ ok: true, value: scheduler.getStatus() }),
    runSchedulerNow: async () => {
      try {
        return { ok: true, value: await scheduler.runNow() }
      } catch {
        return { ok: false, code: 'internal', message: '지금 실행하지 못했습니다.' }
      }
    }
  }
}

export function registerSchedulerHandlers(scheduler: Scheduler): void {
  const h = createSchedulerHandlers(scheduler)
  const guarded =
    <T>(fn: () => Promise<ApiResult<T>>) =>
    (event: IpcMainInvokeEvent): Promise<ApiResult<T>> | ApiResult<never> =>
      isTrustedSender(event)
        ? fn()
        : { ok: false, code: 'forbidden', message: '허용되지 않은 요청입니다.' }
  ipcMain.handle(IPC_CHANNELS.schedulerStatus, guarded(h.getSchedulerStatus))
  ipcMain.handle(IPC_CHANNELS.schedulerRunNow, guarded(h.runSchedulerNow))
}
