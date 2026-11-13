import { realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
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
  'open'
])
/** D-012: 푸시·머지·발행·히스토리 재작성은 게이트 밖에서 허용 규칙으로 열 수 없다 (`DENY_RULES`와 같은 범위). */
const GATED_COMMAND =
  /\bgit\b.*\b(push|reset|rebase|filter-branch|clean)\b|\bgh\b\s+(pr\s+merge|api|auth|release)\b/
/** 에이전트가 쓰지 못해야 하는 경로 조각과 제공자 인증 파일 위치. */
const PROTECTED_FRAGMENT =
  /(\.claude\/|\.ssh|\.env|\.git\/|company\/policies|company\/audit|~\/|\.aws|\.npmrc|id_rsa)/
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
  if (DANGEROUS_FIRST_TOKEN.has(cmd.split(/\s+/)[0] ?? '')) return null
  const rule = `Bash(${cmd})`
  return rule.length <= MAX_RULE ? { rule, summary: `명령 실행: ${cmd}` } : null
}

function isProtectedRel(rel: string): boolean {
  if (PROTECTED_COMPANY_FILES.has(rel)) return true
  if (PROTECTED_COMPANY_DIRS.some((d) => rel.startsWith(d))) return true
  return PROTECTED_FRAGMENT.test(rel) || PROTECTED_FRAGMENT.test(`${rel}/`)
}

/** 존재하는 가장 가까운 상위 폴더까지의 실제 경로(심볼릭 링크 해소)가 회사 폴더 안인지 확인한다. */
async function resolvesInside(root: string, abs: string): Promise<boolean> {
  let cur = abs
  for (;;) {
    try {
      const real = await realpath(cur)
      const rel = relative(root, real)
      return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') return false
      const up = dirname(cur)
      if (up === cur) return false
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
  if (!(await resolvesInside(companyRoot, join(companyRoot, rel)))) return null
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
