import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { RunErrorCode, RunEvent, RunEventBody, RunStartRequest } from '../../shared/run'
import { buildCliEnv } from './cli-env'
import { LineBuffer } from './line-buffer'
import type { RunHrOptions, RunLaunchOptions, RunToolOptions, StartResult } from './types'

export const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000
export const MAX_TIMEOUT_MS = 60 * 60 * 1000
export const MAX_PROMPT_LENGTH = 100_000
const KILL_GRACE_MS = 3000
const MAX_LOG_LINE = 2000

export type SpawnFn = (command: string, args: string[], options: SpawnOptions) => ChildProcess

export interface CliRunnerOptions {
  cwd: string
  command: string
  /** 사용자에게 보이는 메시지에 쓰는 CLI 이름. */
  displayName: string
  spawnFn?: SpawnFn
  /** 이 제공자에만 추가로 통과시킬 환경변수 접두어. */
  envPrefixes?: readonly string[]
  /** 프롬프트를 CLI 인자 배열로 만든다. 프롬프트가 옵션으로 해석되지 않게 하는 책임은 어댑터에 있다. */
  buildArgs: (prompt: string, tools?: RunToolOptions, hr?: RunHrOptions) => string[]
  /** stdout 한 줄을 공통 이벤트로 변환한다. */
  parseLine: (line: string) => RunEventBody[]
  /** parseLine과 별개로 원문 stdout 줄을 관찰한다 (사용량 추출용). */
  onStdoutLine?: (line: string, runId: string) => void
}

export function validateRequest(
  req: unknown
): { ok: true; value: Required<RunStartRequest> } | { ok: false; message: string } {
  if (typeof req !== 'object' || req === null) return { ok: false, message: 'Invalid request' }
  const { prompt, timeoutMs } = req as Record<string, unknown>
  if (typeof prompt !== 'string' || prompt.trim() === '' || prompt.length > MAX_PROMPT_LENGTH) {
    return { ok: false, message: 'Invalid prompt' }
  }
  if (timeoutMs !== undefined) {
    if (
      typeof timeoutMs !== 'number' ||
      !Number.isFinite(timeoutMs) ||
      timeoutMs < 1000 ||
      timeoutMs > MAX_TIMEOUT_MS
    ) {
      return { ok: false, message: 'Invalid timeout' }
    }
  }
  return { ok: true, value: { prompt, timeoutMs: timeoutMs ?? DEFAULT_TIMEOUT_MS } }
}

interface ActiveRun {
  child: ChildProcess
  stop: (code: 'cancelled' | 'timeout') => void
}

/** CLI를 spawn(인자 배열, shell 없음)으로 실행하고 stdout을 이벤트로 흘려보낸다. 취소/타임아웃/에러 매핑은 제공자 공통. */
export class CliRunner {
  private readonly runs = new Map<string, ActiveRun>()
  private readonly spawnFn: SpawnFn

  constructor(private readonly options: CliRunnerOptions) {
    this.spawnFn = options.spawnFn ?? nodeSpawn
  }

  start(req: unknown, emit: (event: RunEvent) => void, launch?: RunLaunchOptions): StartResult {
    let cleaned = false
    // 정리는 한 번만, 실패해도 실행 결과에 영향을 주지 않는다.
    const cleanup = (): void => {
      if (cleaned) return
      cleaned = true
      void Promise.resolve()
        .then(() => launch?.onFinish?.())
        .catch(() => undefined)
    }
    const checked = validateRequest(req)
    if (!checked.ok) {
      cleanup()
      return { ok: false, code: 'invalid-request', message: checked.message }
    }
    const { prompt, timeoutMs } = checked.value

    const name = this.options.displayName
    const runId = randomUUID()
    const send = (body: RunEventBody): void => emit({ ...body, runId })

    let args: string[]
    let child: ChildProcess
    try {
      args = this.options.buildArgs(prompt, launch?.tools, launch?.hr)
      child = this.spawnFn(this.options.command, args, {
        cwd: this.options.cwd,
        shell: false,
        env: buildCliEnv(process.env, this.options.envPrefixes),
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch {
      cleanup()
      return { ok: false, code: 'spawn-failed', message: `Failed to start ${name} CLI` }
    }

    let finished = false
    let stopReason: 'cancelled' | 'timeout' | null = null
    let spawnError: NodeJS.ErrnoException | null = null
    let killTimer: NodeJS.Timeout | undefined

    const stop = (reason: 'cancelled' | 'timeout'): void => {
      if (finished || stopReason) return
      stopReason = reason
      child.kill('SIGTERM')
      // SIGTERM을 무시하는 경우를 대비한 강제 종료.
      killTimer = setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS)
    }
    const timeoutTimer = setTimeout(() => stop('timeout'), timeoutMs)

    this.runs.set(runId, { child, stop })

    const stdoutBuf = new LineBuffer()
    const handleLines = (lines: string[]): void => {
      for (const line of lines) {
        this.options.onStdoutLine?.(line, runId)
        for (const ev of this.options.parseLine(line)) send(ev)
      }
    }
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => handleLines(stdoutBuf.push(chunk)))

    const stderrBuf = new LineBuffer()
    const handleStderr = (lines: string[]): void => {
      for (const l of lines) send({ type: 'log', source: 'stderr', line: l.slice(0, MAX_LOG_LINE) })
    }
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => handleStderr(stderrBuf.push(chunk)))

    // 'error'는 실행 실패(ENOENT 등). 이후 'close'가 오지 않을 수 있어 여기서도 정리한다.
    const finish = (exitCode: number | null, signal: string | null): void => {
      if (finished) return
      finished = true
      clearTimeout(timeoutTimer)
      clearTimeout(killTimer)
      this.runs.delete(runId)
      cleanup()
      handleLines(stdoutBuf.flush())
      handleStderr(stderrBuf.flush())

      if (spawnError) {
        const code: RunErrorCode = spawnError.code === 'ENOENT' ? 'cli-not-found' : 'spawn-failed'
        const message =
          code === 'cli-not-found'
            ? `${name} CLI not found. Install it and make sure it is on PATH.`
            : `Failed to start ${name} CLI`
        send({ type: 'error', code, message })
      } else if (stopReason === 'timeout') {
        send({ type: 'error', code: 'timeout', message: `Run timed out after ${timeoutMs}ms` })
      } else if (stopReason === 'cancelled') {
        send({ type: 'error', code: 'cancelled', message: 'Run cancelled' })
      } else if (exitCode !== 0) {
        send({
          type: 'error',
          code: 'exit-nonzero',
          message: `${name} CLI exited with code ${exitCode ?? signal ?? 'unknown'}`
        })
      }
      send({ type: 'exit', exitCode, signal })
    }

    child.on('error', (err: NodeJS.ErrnoException) => {
      spawnError = err
      finish(null, null)
    })
    child.on('close', (code, signal) => finish(code, signal))

    return { ok: true, runId }
  }

  cancel(runId: string): boolean {
    const run = this.runs.get(runId)
    if (!run) return false
    run.stop('cancelled')
    return true
  }

  cancelAll(): void {
    for (const run of this.runs.values()) run.stop('cancelled')
  }
}
