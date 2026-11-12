import { lstat, mkdir, realpath, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, normalize, sep } from 'node:path'
import type { CompanyCreateResult, CompanyErrorCode } from '../../shared/company'
import { COMPANY_DIRS, buildCompanyFiles } from './templates'

const MAX_NAME_LENGTH = 50
const MAX_PATH_LENGTH = 1024
// Windows 파일명 금지 문자와 제어 문자. 두 OS 모두에서 같은 폴더가 만들어지도록 함께 막는다.
// eslint-disable-next-line no-control-regex
const FORBIDDEN_NAME_CHARS = /[<>:"/\\|?*\u0000-\u001f]/
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

class ScaffoldError extends Error {
  constructor(
    readonly code: CompanyErrorCode,
    message: string
  ) {
    super(message)
  }
}

/** 이름 규칙을 검사한다. 위반 시 이유를 돌려주고, 통과하면 null. */
export function validateCompanyName(name: unknown): string | null {
  if (typeof name !== 'string') return '이름은 문자열이어야 합니다.'
  if (name.length === 0 || name.length > MAX_NAME_LENGTH)
    return `이름은 1~${MAX_NAME_LENGTH}자여야 합니다.`
  if (name !== name.trim()) return '이름 앞뒤에 공백을 둘 수 없습니다.'
  if (name.startsWith('.')) return '이름은 .으로 시작할 수 없습니다.'
  if (name.endsWith('.')) return '이름은 .으로 끝날 수 없습니다.'
  if (FORBIDDEN_NAME_CHARS.test(name)) return '이름에 쓸 수 없는 문자가 있습니다.'
  if (WINDOWS_RESERVED.test(name)) return '시스템 예약 이름은 쓸 수 없습니다.'
  return null
}

/** 상위 디렉터리를 검증하고 실제(심볼릭 해소) 경로를 돌려준다. */
async function resolveParentDir(path: unknown): Promise<string> {
  if (typeof path !== 'string' || path.length === 0 || path.length > MAX_PATH_LENGTH)
    throw new ScaffoldError('invalid-path', '경로가 올바르지 않습니다.')
  if (path.includes('\0')) throw new ScaffoldError('invalid-path', '경로가 올바르지 않습니다.')
  if (!isAbsolute(path)) throw new ScaffoldError('invalid-path', '절대 경로여야 합니다.')
  // 정규화 전 원문에 '..' 구간이 있으면 의도를 알 수 없으므로 거부한다.
  if (path.split(/[\\/]/).includes('..'))
    throw new ScaffoldError('invalid-path', '경로에 ..을 쓸 수 없습니다.')
  const normalized = normalize(path)
  let real: string
  try {
    real = await realpath(normalized)
    if (!(await stat(real)).isDirectory()) throw new Error('not a directory')
  } catch {
    throw new ScaffoldError('invalid-path', '존재하는 폴더를 선택해야 합니다.')
  }
  // 파일 시스템 루트 자체에는 만들지 않는다.
  if (dirname(real) === real)
    throw new ScaffoldError('invalid-path', '루트 폴더에는 만들 수 없습니다.')
  return real
}

/**
 * `parentDir/name`에 회사 폴더를 만든다. 기존 항목(심볼릭 링크 포함)이 있으면 거부하고 덮어쓰지 않는다.
 * 실패해도 부분 생성된 폴더는 지우지 않는다 (파괴적 삭제를 피하고, 재시도 시 already-exists로 드러난다).
 */
export async function createCompanyFolder(
  name: unknown,
  parentPath: unknown
): Promise<CompanyCreateResult> {
  const nameError = validateCompanyName(name)
  if (nameError !== null) return { ok: false, code: 'invalid-name', message: nameError }
  const companyName = name as string

  try {
    const parent = await resolveParentDir(parentPath)
    const target = join(parent, companyName)
    // 이름 규칙상 구분자가 없지만, 결과가 parent 직속인지 한 번 더 확인한다.
    if (dirname(target) !== parent || target.includes(`${sep}..${sep}`))
      throw new ScaffoldError('invalid-name', '이름이 올바르지 않습니다.')

    const existing = await lstat(target).catch(() => null)
    if (existing !== null)
      throw new ScaffoldError('already-exists', '같은 이름의 폴더나 파일이 이미 있습니다.')

    // recursive 없이 만들어 동시 생성 경쟁에서도 EEXIST로 실패하게 한다.
    await mkdir(target).catch((e: NodeJS.ErrnoException) => {
      if (e.code === 'EEXIST')
        throw new ScaffoldError('already-exists', '같은 이름의 폴더나 파일이 이미 있습니다.')
      throw e
    })
    for (const dir of COMPANY_DIRS)
      await mkdir(join(target, ...dir.split('/')), { recursive: true })
    for (const [rel, content] of Object.entries(buildCompanyFiles(companyName))) {
      // 'wx': 파일이 이미 있으면 실패한다.
      await writeFile(join(target, ...rel.split('/')), content, { flag: 'wx', encoding: 'utf8' })
    }
    return { ok: true, companyDir: target }
  } catch (e) {
    if (e instanceof ScaffoldError) return { ok: false, code: e.code, message: e.message }
    // 내부 경로가 담긴 원본 오류 메시지는 renderer에 보내지 않는다.
    return { ok: false, code: 'create-failed', message: '회사 폴더를 만들지 못했습니다.' }
  }
}
