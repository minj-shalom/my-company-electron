import { lstat, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, resolve, sep } from 'node:path'
import { MAX_PROJECT_PATH, hasForbiddenChar } from '../../shared/project'

export type PathRejection =
  | 'invalid' // 형태 오류 (문자열이 아님, 너무 김, 제어 문자)
  | 'not-absolute'
  | 'dotdot'
  | 'not-found'
  | 'not-directory'
  | 'too-broad' // 파일 시스템 루트나 홈 폴더
  | 'company-overlap' // 회사 폴더 자신, 그 상위 또는 하위
  | 'unreadable'

export type PathCheck = { ok: true; real: string } | { ok: false; reason: PathRejection }

export interface PathContext {
  /** 심볼릭 링크를 해소한 회사 폴더 경로. */
  companyRoot: string
  homeDir?: string
}

/** macOS/Windows 기본 파일 시스템은 대소문자를 구분하지 않으므로 비교할 때 접는다. */
export const foldPath = (p: string): string => (process.platform === 'linux' ? p : p.toLowerCase())

const within = (child: string, parent: string): boolean => {
  const a = foldPath(child)
  const b = foldPath(parent)
  return a === b || a.startsWith(b.endsWith(sep) ? b : b + sep)
}

async function realHome(homeDir: string): Promise<string> {
  try {
    return await realpath(homeDir)
  } catch {
    return homeDir
  }
}

/**
 * 심볼릭 링크를 해소한 뒤 판정한다 (링크로 회사 폴더나 홈을 우회하지 못하게).
 * `allowRelative`는 기존 단일 형식의 상대 경로(`../repo`)를 회사 폴더 기준으로 읽을 때만 쓴다. 새로 받는 경로는 절대 경로여야 하고 `..`를 거부한다.
 */
export async function checkProjectDir(
  input: unknown,
  ctx: PathContext,
  allowRelative = false
): Promise<PathCheck> {
  if (typeof input !== 'string' || input.length === 0 || input.length > MAX_PROJECT_PATH)
    return { ok: false, reason: 'invalid' }
  if (hasForbiddenChar(input)) return { ok: false, reason: 'invalid' }
  let abs = input
  if (!allowRelative) {
    if (!isAbsolute(input)) return { ok: false, reason: 'not-absolute' }
    if (input.split(/[\\/]/).includes('..')) return { ok: false, reason: 'dotdot' }
  } else if (!isAbsolute(input)) abs = resolve(ctx.companyRoot, input)
  let real: string
  try {
    real = await realpath(abs)
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    return {
      ok: false,
      reason: code === 'ENOENT' || code === 'ENOTDIR' ? 'not-found' : 'unreadable'
    }
  }
  try {
    if (!(await stat(real)).isDirectory()) return { ok: false, reason: 'not-directory' }
  } catch {
    return { ok: false, reason: 'unreadable' }
  }
  const home = await realHome(ctx.homeDir ?? homedir())
  if (dirname(real) === real || foldPath(real) === foldPath(home))
    return { ok: false, reason: 'too-broad' }
  // 회사 폴더 자신, 상위(회사 폴더를 품은 폴더), 하위(회사 폴더 안)는 모두 거부한다.
  if (within(real, ctx.companyRoot) || within(ctx.companyRoot, real))
    return { ok: false, reason: 'company-overlap' }
  return { ok: true, real }
}

/** 폴더 안에 `.git`(폴더 또는 worktree·submodule 파일)이 있는지. 링크는 따라가지 않는다. */
export async function hasGitEntry(dir: string): Promise<boolean> {
  try {
    const st = await lstat(resolve(dir, '.git'))
    return st.isDirectory() || st.isFile()
  } catch {
    return false
  }
}

export const PATH_MESSAGES: Record<PathRejection, string> = {
  invalid: '경로가 올바르지 않습니다.',
  'not-absolute': '절대 경로여야 합니다.',
  dotdot: '경로에 ..을 쓸 수 없습니다.',
  'not-found': '폴더를 찾을 수 없습니다.',
  'not-directory': '폴더를 선택해야 합니다.',
  'too-broad': '홈 폴더나 최상위 폴더는 프로젝트로 쓸 수 없습니다.',
  'company-overlap': '회사 폴더와 겹치는 폴더는 프로젝트로 쓸 수 없습니다.',
  unreadable: '폴더를 읽을 수 없어요. 접근 권한을 확인해 주세요.'
}
