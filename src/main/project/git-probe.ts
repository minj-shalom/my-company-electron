import { spawn } from 'node:child_process'
import { lstat, open } from 'node:fs/promises'
import { join } from 'node:path'
import type { ProjectGit } from '../../shared/project'
import { MAX_BRANCH, hasForbiddenChar } from '../../shared/project'
import { isValidBranch } from './project-doc'

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
  // GIT_CONFIG_NOSYSTEM: 시스템 전역 gitconfig(/etc/gitconfig 등)의 설정이 명령 실행(fsmonitor, 외부 helper 등)에 끼어들지 못하게 막는다.
  const env: NodeJS.ProcessEnv = { GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', LC_ALL: 'C' }
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
  if (status.kind !== 'done' || status.code !== 0)
    return { status: 'unavailable', branch: await readHeadBranch(dir) }
  return {
    status: 'ok',
    // 커밋이 없는 새 레포는 HEAD를 풀지 못해 실패한다. 브랜치를 모를 뿐 오류는 아니다.
    branch: branch.kind === 'done' && branch.code === 0 ? singleLine(branch.stdout) : null,
    dirty: status.stdout.trim() !== ''
  }
}

const MAX_HEAD_BYTES = 512
const HEAD_REF_PREFIX = 'ref: refs/heads/'

/**
 * git을 실행하지 못할 때의 폴백. `.git`이 진짜 폴더일 때만 `HEAD` 파일을 직접 읽어 브랜치를 얻는다.
 * `.git`이 심볼릭 링크나 파일(worktree/submodule 포인터)이면 따라가지 않는다. detached HEAD나 읽기 실패는 null.
 */
export async function readHeadBranch(dir: string): Promise<string | null> {
  try {
    const gitDir = join(dir, '.git')
    if (!(await lstat(gitDir)).isDirectory()) return null
    const headPath = join(gitDir, 'HEAD')
    if (!(await lstat(headPath)).isFile()) return null
    const fh = await open(headPath, 'r')
    try {
      const buf = Buffer.alloc(MAX_HEAD_BYTES)
      const { bytesRead } = await fh.read(buf, 0, MAX_HEAD_BYTES, 0)
      const text = buf.subarray(0, bytesRead).toString('utf8').trim()
      return text.startsWith(HEAD_REF_PREFIX)
        ? singleLine(text.slice(HEAD_REF_PREFIX.length))
        : null
    } finally {
      await fh.close()
    }
  } catch {
    return null
  }
}

/** 판정할 수 없을 때의 내부 기본값. 화면에는 노출하지 않는다. */
export const FALLBACK_DEFAULT_BRANCH = 'main'

/**
 * 프로젝트 추가 시 기본 브랜치를 자동 판정한다 (develop 브랜치 우선, 없으면 현재 브랜치, 그래도 모르면 내부 기본값).
 * 읽기 전용 git 호출만 쓰며, 실행 실패·시간 초과·detached HEAD는 다음 순서로 넘어간다.
 */
export async function detectDefaultBranch(run: GitRunner, dir: string): Promise<string> {
  const dev = await run(
    ['show-ref', '--verify', '--quiet', 'refs/heads/develop'],
    dir,
    GIT_TIMEOUT_MS
  )
  if (dev.kind === 'done' && dev.code === 0) return 'develop'
  // 커밋이 없는 새 레포도 symbolic-ref로는 브랜치 이름을 얻는다.
  const cur = await run(['symbolic-ref', '--short', 'HEAD'], dir, GIT_TIMEOUT_MS)
  if (cur.kind === 'done' && cur.code === 0) {
    const name = singleLine(cur.stdout)
    if (name !== null && isValidBranch(name)) return name
  }
  const head = await readHeadBranch(dir)
  return head !== null && isValidBranch(head) ? head : FALLBACK_DEFAULT_BRANCH
}
