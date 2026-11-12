import type { SpawnOptions } from 'node:child_process'
import { spawn as nodeSpawn } from 'node:child_process'
import type { DetectState } from '../../shared/provider'
import type { SpawnFn } from './cli-runner'
import type { ProviderInstallStatus } from './types'

export const PROBE_TIMEOUT_MS = 5000
const MAX_VERSION_LENGTH = 100

export interface ProbeOutcome {
  state: DetectState
  version: string | null
}

/**
 * 고정 인자로 CLI를 실행해 상태를 구분해 돌려준다. shell 없이 인자 배열로 실행한다.
 * ENOENT는 미설치, 그 외 spawn 오류와 비정상 종료는 실행 실패, 시간 초과는 timeout이다.
 * 원본 오류 객체는 밖으로 내보내지 않는다.
 */
export function probeOutcome(
  command: string,
  args: readonly string[],
  spawnFn: SpawnFn = nodeSpawn,
  timeoutMs = PROBE_TIMEOUT_MS,
  extraOptions: SpawnOptions = {}
): Promise<ProbeOutcome> {
  return new Promise((resolve) => {
    let child
    try {
      child = spawnFn(command, [...args], {
        ...extraOptions,
        shell: false,
        stdio: ['ignore', 'pipe', 'ignore']
      })
    } catch (err) {
      const code = (err as { code?: unknown } | null)?.code
      resolve({ state: code === 'ENOENT' ? 'not-installed' : 'exec-failed', version: null })
      return
    }

    let settled = false
    let out = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      done({ state: 'timeout', version: null })
    }, timeoutMs)
    function done(outcome: ProbeOutcome): void {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(outcome)
    }

    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      if (out.length < MAX_VERSION_LENGTH * 4) out += chunk
    })
    child.on('error', (err: NodeJS.ErrnoException) =>
      done({ state: err.code === 'ENOENT' ? 'not-installed' : 'exec-failed', version: null })
    )
    child.on('close', (code) => {
      const first = out.split('\n')[0]?.trim().slice(0, MAX_VERSION_LENGTH) ?? ''
      done(
        code === 0
          ? { state: 'ok', version: first || null }
          : { state: 'exec-failed', version: null }
      )
    })
  })
}

/** `<command> --version`을 실행해 설치 여부와 버전을 확인한다 (T-007 계약: 상태 구분 없이 installed만). */
export async function probeVersion(
  command: string,
  spawnFn: SpawnFn = nodeSpawn,
  timeoutMs = PROBE_TIMEOUT_MS
): Promise<ProviderInstallStatus> {
  const r = await probeOutcome(command, ['--version'], spawnFn, timeoutMs)
  return r.state === 'ok'
    ? { installed: true, version: r.version }
    : { installed: false, version: null }
}
