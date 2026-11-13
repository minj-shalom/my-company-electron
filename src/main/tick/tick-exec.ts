import type { RunErrorCode, RunEvent } from '../../shared/run'
import type { RunLaunchOptions, ProviderAdapter } from '../providers/types'

export interface ExecResult {
  /** 어댑터가 보고한 오류 코드. 정상 종료면 null. */
  error: RunErrorCode | null
  /** `result` 이벤트가 성공이 아니라고 했는지. */
  resultFailed: boolean
  text: string | null
}

/**
 * 어댑터 실행 한 번을 끝까지 기다린다. 어떤 경로(정상, 시간 초과, 취소, 시작 실패)로 끝나도 resolve하고 던지지 않는다.
 * `signal`이 중단되면 실행을 취소한다. 리스너는 항상 해제한다.
 */
export function execOnce(
  adapter: ProviderAdapter,
  prompt: string,
  timeoutMs: number,
  launch: RunLaunchOptions,
  signal: AbortSignal
): Promise<ExecResult> {
  return new Promise<ExecResult>((resolve) => {
    const res: ExecResult = { error: null, resultFailed: false, text: null }
    let runId: string | null = null
    let settled = false
    const onAbort = (): void => {
      if (runId !== null) adapter.cancel(runId)
    }
    const settle = (): void => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      resolve(res)
    }
    const emit = (ev: RunEvent): void => {
      if (ev.type === 'result') {
        res.text = ev.text
        res.resultFailed = !ev.success
      } else if (ev.type === 'error') res.error ??= ev.code
      else if (ev.type === 'exit') settle()
    }
    let started
    try {
      started = adapter.start({ prompt, timeoutMs }, emit, launch)
    } catch {
      res.error = 'spawn-failed'
      settle()
      return
    }
    if (!started.ok) {
      res.error = started.code
      settle()
      return
    }
    runId = started.runId
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
  })
}
