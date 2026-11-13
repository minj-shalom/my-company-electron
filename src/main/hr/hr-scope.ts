import { isProtectedPath } from '../integrity/protected-files'

/** hr 전용 실행의 도구. Bash가 없는 것이 핵심이다 (경로 규칙은 셸 명령을 제한하지 못한다). */
export const HR_TOOLS = ['Read', 'Write', 'Edit', 'Grep', 'Glob'] as const

/** 보호 직원 파일(쓰기 금지, 변경안은 제안으로 올린다). COO 정의는 `CLAUDE.md`이며 아래 금지 목록에 있다. */
export const HR_PROTECTED_AGENTS = ['cto', 'cfo', 'hr', 'coo'] as const

/** 쓰기 허용 목록: 직원 파일, org.md, 퇴사 보관 폴더, project.md(파일 단위. 줄 단위 제한은 편집 후 diff 검증이 강제한다). */
export const HR_ALLOW_PATHS: readonly string[] = [
  '.claude/agents/*.md',
  'company/org.md',
  'company/archive/**',
  'company/project.md'
]

/** 쓰기 금지 목록. 허용 목록에 없으면 어차피 거부되지만 설정 오류에 대비한 이중 방어다. */
export const HR_DENY_WRITE_PATHS: readonly string[] = [
  ...HR_PROTECTED_AGENTS.map((a) => `.claude/agents/${a}.md`),
  'CLAUDE.md',
  '.claude/settings*',
  '.claude/rules/**',
  'company/tickets/**',
  'company/policies/**',
  'company/decisions/**',
  'company/finance/**',
  'company/audit/**',
  'company/reports/**',
  'company/schedules/**',
  'company/hr-requests/**',
  'company/mission.md',
  'company/architecture.md',
  'company/handoff.md',
  '~/.claude/**',
  '~/.ssh/**'
]

/** 읽기 금지: 자격 증명 파일. */
export const HR_DENY_READ_PATHS: readonly string[] = ['~/.claude/**', '~/.ssh/**', '**/.env*']

const WRITE_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'] as const
const rules = (tools: readonly string[], paths: readonly string[]): string[] =>
  tools.flatMap((t) => paths.map((p) => `${t}(${p})`))

/** 실행별 임시 설정 파일의 내용. 회사 폴더에 영구 저장하지 않는다. */
export function buildHrSettings(): { permissions: { allow: string[]; deny: string[] } } {
  return {
    permissions: {
      allow: rules(['Edit', 'Write'], HR_ALLOW_PATHS),
      deny: [...rules(WRITE_TOOLS, HR_DENY_WRITE_PATHS), ...rules(['Read'], HR_DENY_READ_PATHS)]
    }
  }
}

/**
 * 앱이 hr 실행 뒤 변경을 판정할 때 쓰는 허용 판정 (허용 목록의 코드 형태). 회사 폴더 기준 상대 경로.
 * 보호 직원 파일은 허용 목록의 `*.md`에 걸리지만 쓰기 금지이므로 여기서 뺀다.
 */
export function isHrWritablePath(rel: string): boolean {
  if (rel.includes('\\') || rel.includes('\0') || rel.split('/').includes('..')) return false
  if (rel === 'company/org.md' || rel === 'company/project.md') return true
  if (rel.startsWith('company/archive/')) return rel.length > 'company/archive/'.length
  const m = /^\.claude\/agents\/([^/]+)\.md$/.exec(rel)
  return m !== null && !(HR_PROTECTED_AGENTS as readonly string[]).includes(m[1])
}

/**
 * 허용 목록 밖 변경 중 이 앱의 다른 감시(`IntegrityService`)가 이미 맡는 경로. 같은 변경에 카드가 둘 생기지 않게 제외한다.
 * 보호 직원 파일과 정책 파일이 여기에 든다.
 */
export const coveredByIntegrity = (rel: string): boolean => isProtectedPath(rel)
