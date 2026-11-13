import { realpath, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { PermissionDenial } from '../../shared/run'

/** 허용 규칙으로 바꿀 수 있는 거부 동작과 그 규칙. 원문 입력은 담지 않고 검증을 통과한 값만 담는다. */
export interface AllowRule {
  /** Claude 허용 규칙 문자열 (`Bash(npm test)`, `Edit(docs/a.md)`). */
  rule: string
  /** 카드에 보여주는 한 줄 설명. */
  summary: string
}

const MAX_COMMAND = 300
const FILE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
/** 에이전트가 쓰지 못해야 하는 경로 조각과 제공자 인증 파일 위치. */
const PROTECTED_FRAGMENT =
  /(\.claude|\.ssh|\.env|\.git\/|company\/policies|company\/audit|~\/|\.aws|\.npmrc|id_rsa)/i
const PROTECTED_COMPANY_FILES = new Set([
  'company/org.md',
  'company/project.md',
  'company/recurring.md',
  // 의존성·실행 스크립트·에이전트 지침을 바꾸면 이후 실행이 임의 코드가 되므로 막는다 (소문자 비교).
  'package.json',
  'package-lock.json',
  'claude.md'
])
const PROTECTED_COMPANY_DIRS = ['company/publishing/', 'company/archive/', 'scripts/']
// eslint-disable-next-line no-control-regex
const PATH_FORBIDDEN = /[\0-\x1f\x7f*?[\]{}\\!]/

/**
 * Bash는 허용 목록 방식이다: 아래 명령과 글자 그대로 일치할 때만 규칙 후보가 된다.
 * 차단 목록은 따옴표 분할, 래퍼, 실행기 변형으로 계속 우회되므로 쓰지 않는다.
 * 따옴표, 백슬래시, `$`, 환경변수 할당, 래퍼, 추가 인자는 목록에 없으므로 자동으로 거부된다.
 * 푸시·머지·발행과 파괴적 명령은 목록에 없으며 게이트(D-012)로만 실행된다.
 */
const SAFE_COMMANDS: ReadonlySet<string> = new Set([
  'npm test',
  'npm run test',
  'npm run lint',
  'npm run typecheck',
  'npm run build',
  'git status',
  'git diff',
  'git diff --stat',
  'git log',
  'git log --oneline'
])

export function commandRule(command: string): AllowRule | null {
  if (!SAFE_COMMANDS.has(command)) return null
  return { rule: `Bash(${command})`, summary: `명령 실행: ${command}` }
}

function isProtectedRel(raw: string): boolean {
  // 대소문자를 구분하지 않는 파일 시스템(macOS 기본)에서 `Company/Org.md`로 우회하지 못하게 한다.
  const rel = raw.toLowerCase()
  if (PROTECTED_COMPANY_FILES.has(rel)) return true
  if (PROTECTED_COMPANY_DIRS.some((d) => rel.startsWith(d))) return true
  return PROTECTED_FRAGMENT.test(rel) || PROTECTED_FRAGMENT.test(`${rel}/`)
}

/** 존재하는 가장 가까운 상위 폴더까지의 실제 경로(심볼릭 링크 해소)가 회사 폴더 안인지 확인한다. */
async function realRelInside(root: string, abs: string): Promise<string | null> {
  let cur = abs
  const rest: string[] = []
  for (;;) {
    try {
      const rel = relative(root, join(await realpath(cur), ...rest))
      return rel.startsWith('..') || isAbsolute(rel) ? null : rel.split(sep).join('/')
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') return null
      const up = dirname(cur)
      if (up === cur) return null
      rest.unshift(basename(cur))
      cur = up
    }
  }
}

export async function fileRule(rawPath: string, companyRoot: string): Promise<AllowRule | null> {
  if (rawPath.length === 0 || rawPath.length > MAX_COMMAND || PATH_FORBIDDEN.test(rawPath))
    return null
  const abs = isAbsolute(rawPath) ? resolve(rawPath) : resolve(companyRoot, rawPath)
  const rel = relative(companyRoot, abs).split(sep).join('/')
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel) || rel.split('/').includes('..'))
    return null
  if (isProtectedRel(rel)) return null
  // 디렉터리는 규칙 대상이 아니다 (하위 전체가 열리지 않게).
  if ((await stat(abs).catch(() => null))?.isDirectory() === true) return null
  // 폴더 안의 심볼릭 링크가 보호 경로로 해소되는 경우도 막는다.
  const real = await realRelInside(companyRoot, join(companyRoot, rel))
  if (real === null || (real !== '' && isProtectedRel(real))) return null
  return { rule: `Edit(${rel})`, summary: `파일 쓰기: ${rel}` }
}

/**
 * 거부 정보 하나를 허용 규칙으로 바꾼다. 안전하게 좁힐 수 없으면 null이다 (카드를 만들지 않는다).
 * 저장 직전에 같은 검증을 한 번 더 거치므로 카드 본문이나 저장된 값은 신뢰하지 않는다.
 */
export async function deriveAllowRule(
  denial: PermissionDenial,
  companyRoot: string
): Promise<AllowRule | null> {
  if (denial.tool === 'Bash') return denial.command === null ? null : commandRule(denial.command)
  if (FILE_TOOLS.has(denial.tool))
    return denial.path === null ? null : fileRule(denial.path, companyRoot)
  return null
}

/** 저장된 규칙 문자열을 다시 검증한다. 우리가 만든 형태(`Bash(<명령>)`, `Edit(<상대 경로>)`)만 통과한다. */
export async function revalidateRule(rule: string, companyRoot: string): Promise<AllowRule | null> {
  const bash = /^Bash\((.+)\)$/s.exec(rule)
  if (bash) {
    const r = commandRule(bash[1])
    return r !== null && r.rule === rule ? r : null
  }
  const edit = /^Edit\((.+)\)$/s.exec(rule)
  if (edit && !isAbsolute(edit[1])) {
    const r = await fileRule(edit[1], companyRoot)
    return r !== null && r.rule === rule ? r : null
  }
  return null
}
