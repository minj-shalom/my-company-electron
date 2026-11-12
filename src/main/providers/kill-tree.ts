import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import { windowsSystem32Path, type ExecEnv } from './executable'
import type { SpawnFn } from './cli-runner'

export interface KillDeps {
  spawnFn?: SpawnFn
  /** process.kill 대체 (테스트용). */
  killPid?: (pid: number, signal: NodeJS.Signals) => void
}

/**
 * POSIX에서는 자식을 새 프로세스 그룹(detached)으로 띄워 그룹 전체를 종료할 수 있게 한다.
 * 부작용: 앱이 비정상 종료하면 이 자식은 고아로 남을 수 있고, 터미널 Ctrl-C가 전달되지 않는다.
 * 그래서 호출 측은 반드시 타임아웃/종료 시 terminateTree를 부른다.
 * Windows는 detached를 쓰지 않고 taskkill /T로 트리를 종료한다.
 */
export function treeSpawnOptions(ctx: ExecEnv): { detached: boolean } {
  return { detached: ctx.platform !== 'win32' }
}

/**
 * 자식과 그 하위 프로세스를 종료한다. 항상 마지막에 child.kill('SIGKILL')도 시도한다.
 * - Windows: `%SystemRoot%\System32\taskkill.exe /PID <정수> /T /F`를 인자 배열로 실행 (shell 없음).
 *   SystemRoot가 안전하지 않으면 taskkill을 실행하지 않고 cmd.exe만 종료한다 (한계: 손자 프로세스가 남을 수 있음).
 * - POSIX: `process.kill(-pid)`로 그룹 종료. detached로 띄우지 않은 자식에는 쓰지 않는다.
 */
export function terminateTree(
  child: ChildProcess,
  ctx: ExecEnv,
  deps: KillDeps = {},
  grouped = true
): void {
  const pid = child.pid
  if (typeof pid === 'number' && Number.isSafeInteger(pid) && pid > 0) {
    try {
      if (ctx.platform === 'win32') {
        const exe = windowsSystem32Path('taskkill.exe', ctx)
        if (exe !== null) {
          const killer = (deps.spawnFn ?? nodeSpawn)(exe, ['/PID', String(pid), '/T', '/F'], {
            shell: false,
            stdio: 'ignore',
            windowsHide: true
          })
          killer.on('error', () => {})
          killer.unref?.()
        }
      } else if (grouped) {
        ;(deps.killPid ?? process.kill)(-pid, 'SIGKILL')
      }
    } catch {
      // 이미 종료된 그룹(ESRCH) 등. 아래 직접 kill로 계속한다.
    }
  }
  child.kill('SIGKILL')
}
