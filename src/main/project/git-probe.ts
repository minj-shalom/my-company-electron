import { spawn } from 'node:child_process'
import type { ProjectGit } from '../../shared/project'
import { MAX_BRANCH, hasForbiddenChar } from '../../shared/project'

/**
 * 레포 읽기 전용 조회. `git`을 `spawn` + 인자 배열로만 실행한다 (셸 없음).
 * - 허용 명령은 `rev-parse`와 `status --porcelain`뿐이다.
 * - 레포 설정이 명령을 실행하지 못하게 `core.fsmonitor=false`로 두고, `--no-optional-locks`로 인덱스를 갱신(쓰기)하지 않게 한다.
 * - 자식 프로세스에는 PATH 등 최소 환경변수만 넘긴다 (토큰 등 비밀을 넘기지 않는다).
 */

export const GIT_TIMEOUT_MS = 3000
const MAX_OUTPUT_BYTES = 64 * 1024

export type GitOutcome =
  { kind: 'done'; code: number; stdout: string } | { kind: 'timeout' } | { kind: 'unavailable' }

/** 테스트에서 바꿔 끼운다. */
export type GitRunner = (
  args: readonly string[],
  cwd: string,
  timeoutMs: number
) => Promise<GitOutcome>

const SAFE_ENV_KEYS = ['PATH', 'HOME', 'USERPROFILE', 'SystemRoot', 'TMPDIR', 'TEMP', 'TMP']

function minimalEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' }
  for (const k of SAFE_ENV_KEYS) {
    const v = process.env[k]
    if (v !== undefined) env[k] = v
  }
  return env
}

const GIT_PREFIX = ['--no-optional-locks', '-c', 'core.fsmonitor=false'] as const

export const spawnGit: GitRunner = (args, cwd, timeoutMs) =>
  new Promise((resolve) => {
    let settled = false
    const finish = (o: GitOutcome): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(o)
    }
    let child
    try {
      child = spawn('git', [...GIT_PREFIX, ...args], {
        cwd,
        env: minimalEnv(),
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore']
      })
    } catch {
      resolve({ kind: 'unavailable' })
      return
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish({ kind: 'timeout' })
    }, timeoutMs)
    let out = ''
    let overflow = false
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      if (out.length < MAX_OUTPUT_BYTES) out += chunk
      // `status --porcelain`은 출력이 있으면 이미 "변경 있음"이므로 더 읽지 않는다.
      if (out.length >= MAX_OUTPUT_BYTES && !overflow) {
        overflow = true
        child.kill('SIGKILL')
      }
    })
    child.on('error', () => finish({ kind: 'unavailable' }))
    child.on('close', (code) => {
      if (overflow) finish({ kind: 'done', code: 0, stdout: out })
      else finish({ kind: 'done', code: code ?? -1, stdout: out })
    })
  })

function singleLine(v: string): string | null {
  const line = v.split('\n')[0].trim()
  return line !== '' && line.length <= MAX_BRANCH && !hasForbiddenChar(line) ? line : null
}

/** 폴더 자신이 레포 루트인지 확인할 때 쓰는 `git rev-parse --show-toplevel` 결과. 조회 불가는 null. */
export async function gitToplevel(
  run: GitRunner,
  dir: string
): Promise<{ ok: true; top: string | null } | { ok: false }> {
  const r = await run(['rev-parse', '--show-toplevel'], dir, GIT_TIMEOUT_MS)
  if (r.kind !== 'done') return { ok: false }
  return { ok: true, top: r.code === 0 ? singleLine(r.stdout) : null }
}

/** 현재 브랜치와 변경 여부. 호출자가 폴더에 `.git`이 있음을 이미 확인했다고 가정한다. */
export async function probeGit(run: GitRunner, dir: string): Promise<ProjectGit> {
  const [branch, status] = await Promise.all([
    run(['rev-parse', '--abbrev-ref', 'HEAD'], dir, GIT_TIMEOUT_MS),
    run(['status', '--porcelain'], dir, GIT_TIMEOUT_MS)
  ])
  if (status.kind !== 'done' || status.code !== 0) return { status: 'unavailable' }
  return {
    status: 'ok',
    // 커밋이 없는 새 레포는 HEAD를 풀지 못해 실패한다. 브랜치를 모를 뿐 오류는 아니다.
    branch: branch.kind === 'done' && branch.code === 0 ? singleLine(branch.stdout) : null,
    dirty: status.stdout.trim() !== ''
  }
}
