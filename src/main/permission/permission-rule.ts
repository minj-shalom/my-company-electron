import { realpath } from 'node:fs/promises'
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
const MAX_RULE = 400
const FILE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

/** 규칙 문법을 깨거나 여러 명령을 이어 붙이는 문자. 와일드카드는 사람이 직접 쓰기 전에는 만들지 않는다. */
// 제어문자 검사가 목적이므로 no-control-regex를 끈다.
// eslint-disable-next-line no-control-regex
const COMMAND_FORBIDDEN = /[\0-\x1f\x7f*()[\]{}`$;&|<>\\!]/
/** 자격 증명이 들어 있을 수 있는 명령은 카드(파일)에 남기지 않는다. */
const SECRET_HINT = /(token|secret|passw|authorization|bearer|api[_-]?key|credential)/i
const DANGEROUS_FIRST_TOKEN = new Set([
  'sudo',
  'su',
  'rm',
  'dd',
  'chmod',
  'chown',
  'curl',
  'wget',
  'ssh',
  'scp',
  'eval',
  'sh',
  'bash',
  'zsh',
  'env',
  'xargs',
  'nc',
  'open',
  'osascript',
  'perl',
  'ruby',
  'php',
  'python',
  'python2',
  'python3',
  'node',
  'deno',
  'bun',
  'find'
])
/** 앞에 붙어 뒤 명령을 그대로 실행하는 래퍼. 건너뛰고 실제 명령을 본다. */
const WRAPPERS = new Set(['command', 'nice', 'nohup', 'time', 'exec', 'builtin', 'env'])
const ENV_ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/
/** 인터프리터의 인라인 코드 실행 옵션(-e, -c, -pe, --eval 등)과 find의 실행·삭제 옵션. */
const INLINE_CODE_FLAG =
  /^(-[A-Za-z]*[ecEpr][A-Za-z]*|--eval|--exec|--command|-exec|-execdir|-ok|-okdir|-delete)$/

/** 환경변수 할당과 래퍼를 건너뛴 실제 명령의 이름(경로 제거, 소문자)과 그 뒤 인자. */
function effectiveCommand(cmd: string): { name: string; args: string[] } {
  const tokens = cmd.split(/\s+/).filter((t) => t !== '')
  let i = 0
  for (;;) {
    const t = tokens[i]
    if (t === undefined) return { name: '', args: [] }
    const base = (t.split('/').pop() ?? '').toLowerCase()
    if (ENV_ASSIGN.test(t)) i++
    else if (WRAPPERS.has(base)) {
      i++
      // 래퍼의 옵션(`nice -n 5`의 `-n 5`)도 건너뛴다.
      while (tokens[i] !== undefined && /^(-\S*|\d+)$/.test(tokens[i])) i++
    } else return { name: base, args: tokens.slice(i + 1) }
  }
}
/** D-012: 푸시·머지·발행·히스토리 재작성은 게이트 밖에서 허용 규칙으로 열 수 없다 (`DENY_RULES`와 같은 범위). */
const GATED_COMMAND =
  /\bgit\b.*\b(push|reset|rebase|filter-branch|clean)\b|\bgh\b\s+(pr\s+merge|api|auth|release)\b/i
/** 에이전트가 쓰지 못해야 하는 경로 조각과 제공자 인증 파일 위치. */
const PROTECTED_FRAGMENT =
  /(\.claude|\.ssh|\.env|\.git\/|company\/policies|company\/audit|~\/|\.aws|\.npmrc|id_rsa)/i
const PROTECTED_COMPANY_FILES = new Set([
  'company/org.md',
  'company/project.md',
  'company/recurring.md'
])
const PROTECTED_COMPANY_DIRS = ['company/publishing/', 'company/archive/']
// eslint-disable-next-line no-control-regex
const PATH_FORBIDDEN = /[\0-\x1f\x7f*?[\]{}\\!]/

export function commandRule(command: string): AllowRule | null {
  const cmd = command.trim()
  if (cmd.length === 0 || cmd.length > MAX_COMMAND || COMMAND_FORBIDDEN.test(cmd)) return null
  if (SECRET_HINT.test(cmd) || GATED_COMMAND.test(cmd) || PROTECTED_FRAGMENT.test(cmd)) return null
  const eff = effectiveCommand(cmd)
  if (eff.name === '' || DANGEROUS_FIRST_TOKEN.has(eff.name)) return null
  if (eff.args.some((a) => INLINE_CODE_FLAG.test(a))) return null
  const rule = `Bash(${cmd})`
  return rule.length <= MAX_RULE ? { rule, summary: `명령 실행: ${cmd}` } : null
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
