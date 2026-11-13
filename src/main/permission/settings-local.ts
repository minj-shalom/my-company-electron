import { FsGuardError, MAX_FILE_BYTES, type SafeFs } from '../repository/safe-fs'

/** 회사 폴더의 로컬 설정. Claude CLI가 cwd의 이 파일을 읽어 허용 규칙으로 쓴다 (커밋하지 않는 개인 설정). */
export const SETTINGS_LOCAL_PATH = '.claude/settings.local.json'
const MAX_ALLOW_RULES = 200

export type AddRuleResult = 'added' | 'exists' | 'unreadable' | 'full'

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * 허용 규칙 한 줄을 `permissions.allow`에 더한다. 호출 측이 사용자 승인과 규칙 검증을 끝낸 뒤에만 부른다.
 * 기존 파일을 해석하지 못하면 덮어쓰지 않고 `unreadable`로 거부한다 (사용자 설정 보존).
 */
export async function addAllowRule(fs: SafeFs, rule: string): Promise<AddRuleResult> {
  let root: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(await fs.readText(SETTINGS_LOCAL_PATH))
    if (!isObject(parsed)) return 'unreadable'
    root = parsed
  } catch (e) {
    if (!(e instanceof FsGuardError && e.kind === 'missing')) return 'unreadable'
  }
  const perms = root['permissions']
  if (perms !== undefined && !isObject(perms)) return 'unreadable'
  const allowRaw = perms?.['allow']
  if (allowRaw !== undefined && !Array.isArray(allowRaw)) return 'unreadable'
  const allow: unknown[] = allowRaw ?? []
  if (allow.includes(rule)) return 'exists'
  if (allow.length >= MAX_ALLOW_RULES) return 'full'
  const next = { ...root, permissions: { ...perms, allow: [...allow, rule] } }
  const text = `${JSON.stringify(next, null, 2)}\n`
  if (Buffer.byteLength(text, 'utf8') > MAX_FILE_BYTES) return 'full'
  await fs.writeText(SETTINGS_LOCAL_PATH, text, true)
  return 'added'
}
