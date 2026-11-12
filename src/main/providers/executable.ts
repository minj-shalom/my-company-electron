import { accessSync, constants, statSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { PROVIDER_CLI_IDS, type ProviderCliId } from '../../shared/provider'

/** 플랫폼과 파일 시스템 접근을 주입해 macOS에서 Windows 규칙을 테스트할 수 있게 한다. */
export interface ExecEnv {
  platform: NodeJS.Platform
  env: Readonly<Record<string, string | undefined>>
  /** 일반 파일이며 (POSIX는) 실행 가능한지. */
  isExecutable: (file: string) => boolean
  homeDir: string
}

export function defaultExecEnv(): ExecEnv {
  return {
    platform: process.platform,
    env: process.env,
    isExecutable: (file) => {
      try {
        if (!statSync(file).isFile()) return false
        if (process.platform !== 'win32') accessSync(file, constants.X_OK)
        return true
      } catch {
        return false
      }
    },
    homeDir: homedir()
  }
}

/** Windows에서 실행을 허용하는 확장자. 선호 순서다 (.exe는 셸 없이 직접 실행 가능). */
const WIN_EXTENSIONS = ['.exe', '.cmd', '.bat'] as const
/** GUI로 띄운 macOS 앱은 PATH가 최소라서 CLI가 흔히 설치되는 위치를 추가로 본다. */
const POSIX_EXTRA_DIRS = ['/opt/homebrew/bin', '/usr/local/bin']

export function isAllowedProvider(name: unknown): name is ProviderCliId {
  return typeof name === 'string' && (PROVIDER_CLI_IDS as readonly string[]).includes(name)
}

/** Windows는 환경변수 이름의 대소문자를 구분하지 않는다 (`Path`, `PATH`). */
function getEnv(env: ExecEnv['env'], key: string, platform: NodeJS.Platform): string | undefined {
  if (platform !== 'win32') return env[key]
  const found = Object.keys(env).find((k) => k.toLowerCase() === key.toLowerCase())
  return found === undefined ? undefined : env[found]
}

/** PATHEXT 중 허용 확장자만 소문자로 정규화해 선호 순서로 돌려준다. 비어 있으면 기본 허용 목록. */
export function windowsExtensions(pathext: string | undefined): string[] {
  const listed = (pathext ?? '')
    .split(';')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => (WIN_EXTENSIONS as readonly string[]).includes(e))
  const pool = listed.length > 0 ? listed : [...WIN_EXTENSIONS]
  return WIN_EXTENSIONS.filter((e) => pool.includes(e))
}

/**
 * 허용 목록의 CLI 이름을 PATH(Windows는 PATHEXT 포함)에서 찾아 실제 파일 경로를 돌려준다.
 * 현재 작업 디렉터리는 탐색하지 않는다 (CreateProcess가 하는 cwd 우선 탐색을 피한다).
 * 없으면 null.
 */
export function resolveExecutable(name: ProviderCliId, ctx: ExecEnv): string | null {
  if (!isAllowedProvider(name)) return null
  const win = ctx.platform === 'win32'
  const p = win ? path.win32 : path.posix
  const delimiter = win ? ';' : ':'
  const dirs = (getEnv(ctx.env, 'PATH', ctx.platform) ?? '')
    .split(delimiter)
    .map((d) => (win ? d.trim().replace(/^"(.*)"$/, '$1') : d))
    .filter((d) => d !== '' && p.isAbsolute(d))
  if (!win) {
    dirs.push(...POSIX_EXTRA_DIRS, p.join(ctx.homeDir, '.local', 'bin'))
  }
  const fileNames = win
    ? windowsExtensions(getEnv(ctx.env, 'PATHEXT', ctx.platform)).map((e) => name + e)
    : [name]
  for (const dir of dirs) {
    for (const fileName of fileNames) {
      const candidate = p.join(dir, fileName)
      if (ctx.isExecutable(candidate)) return candidate
    }
  }
  return null
}

export interface LaunchSpec {
  file: string
  args: string[]
  /** true면 Node가 인자를 다시 따옴표 처리하지 않는다 (cmd.exe 위임에서만 사용). */
  windowsVerbatimArguments: boolean
}

/**
 * cmd.exe의 명령줄 안에서 따옴표로 감싸도 안전하지 않은 문자.
 * `"`는 따옴표를 닫고, `%`는 따옴표 안에서도 변수 확장되며, `^ & | < >`와 `!`는 보수적으로 차단한다.
 */
// eslint-disable-next-line no-control-regex
const UNSAFE_FOR_CMD = /["%!^&|<>\u0000-\u001f]/

/**
 * 실행 파일 경로와 고정 인자로 spawn 명세를 만든다. 사용자 입력은 여기에 들어오지 않는다.
 * - POSIX와 Windows `.exe`: 경로를 그대로 spawn(shell 없이, 인자 배열).
 * - Windows `.cmd`/`.bat`: Node가 CVE-2024-27980 대응으로 셸 없는 직접 spawn을 막으므로 cmd.exe에 위임한다.
 *   명령줄은 `/d /s /c ""<경로>" <고정 인자>"` 형태다. 인자는 호출 측의 상수(예: --version)이고
 *   경로는 위 위험 문자를 하나도 포함하지 않는 것만 허용하므로 따옴표 탈출이나 변수 확장이 불가능하다.
 * 안전하지 않은 경로면 null.
 */
export function buildLaunch(
  executable: string,
  fixedArgs: readonly string[],
  ctx: ExecEnv
): LaunchSpec | null {
  if (ctx.platform !== 'win32') {
    return { file: executable, args: [...fixedArgs], windowsVerbatimArguments: false }
  }
  const ext = path.win32.extname(executable).toLowerCase()
  if (ext === '.exe') {
    return { file: executable, args: [...fixedArgs], windowsVerbatimArguments: false }
  }
  if (ext !== '.cmd' && ext !== '.bat') return null
  if (!/^[A-Za-z]:\\/.test(executable) || UNSAFE_FOR_CMD.test(executable)) return null
  // 고정 인자도 같은 검사를 통과해야 한다 (공백 구분 토큰만 허용).
  if (fixedArgs.some((a) => !/^[A-Za-z0-9._=-]+$/.test(a))) return null
  const inner = `"${executable}" ${fixedArgs.join(' ')}`.trimEnd()
  return {
    file: cmdExePath(ctx),
    args: ['/d', '/s', '/c', `"${inner}"`],
    windowsVerbatimArguments: true
  }
}

function cmdExePath(ctx: ExecEnv): string {
  const root = getEnv(ctx.env, 'SystemRoot', 'win32')
  if (root && /^[A-Za-z]:\\[^"%!^&|<>]*$/.test(root)) {
    return path.win32.join(root, 'System32', 'cmd.exe')
  }
  return 'cmd.exe'
}
