import type { SpawnFn } from './cli-runner'
import type { ProviderInstallStatus } from './types'
import { spawn as nodeSpawn } from 'node:child_process'

const PROBE_TIMEOUT_MS = 5000
const MAX_VERSION_LENGTH = 100

/** `<command> --version`을 실행해 설치 여부와 버전을 확인한다. shell 없이 인자 배열로 실행한다. */
export function probeVersion(
  command: string,
  spawnFn: SpawnFn = nodeSpawn,
  timeoutMs = PROBE_TIMEOUT_MS
): Promise<ProviderInstallStatus> {
  return new Promise((resolve) => {
    let child
    try {
      child = spawnFn(command, ['--version'], { shell: false, stdio: ['ignore', 'pipe', 'ignore'] })
    } catch {
      resolve({ installed: false, version: null })
      return
    }

    let settled = false
    let out = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      done({ installed: false, version: null })
    }, timeoutMs)
    function done(status: ProviderInstallStatus): void {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(status)
    }

    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      if (out.length < MAX_VERSION_LENGTH * 4) out += chunk
    })
    child.on('error', () => done({ installed: false, version: null }))
    child.on('close', (code) => {
      const first = out.split('\n')[0]?.trim().slice(0, MAX_VERSION_LENGTH) ?? ''
      done(
        code === 0
          ? { installed: true, version: first || null }
          : { installed: false, version: null }
      )
    })
  })
}
