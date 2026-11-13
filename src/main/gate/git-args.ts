import { devNull } from 'node:os'
import { hasRefPrefix } from '../../shared/policy'

/**
 * git/gh 인자 조립과 검증. 게이트는 여기서 만든 인자 배열만 실행하고(셸 없음), 강제 푸시·삭제·히스토리 재작성은
 * 인자를 만들 방법 자체가 없다. `assertSafeArgs`는 만든 인자를 한 번 더 허용 목록으로 확인하는 두 번째 방어선이다.
 */

export class GitArgError extends Error {}

const BRANCH_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/
export const REMOTE = 'origin'
export const SHA_RE = /^[0-9a-f]{40}$/

/** 허용 브랜치 이름인지(형식만). 보호·허용 목록 판정은 호출 측이 실제 이름을 정규화해 한다. */
export function checkBranchName(name: string): string {
  if (
    !BRANCH_RE.test(name) ||
    name.includes('..') ||
    name.includes('//') ||
    name.endsWith('/') ||
    name.endsWith('.') ||
    name.endsWith('.lock') ||
    name.includes('/.') ||
    hasRefPrefix(name)
  )
    throw new GitArgError('허용되지 않는 브랜치 이름입니다.')
  return name
}

/** 전역 `-c`는 훅과 외부 프로토콜을 끄는 고정 값만 쓴다 (에이전트가 쓸 수 있는 저장소 설정으로 실행을 가로채지 못하게). */
const GLOBAL_CONFIG = [
  '-c',
  `core.hooksPath=${devNull}`,
  '-c',
  'protocol.ext.allow=never',
  '-c',
  'core.fsmonitor=false',
  'core.sshCommand=ssh',
  'push.default=nothing'
]
// 한계: credential.helper는 비우지 않는다 (https 푸시가 사용자의 자격 증명 도우미에 의존한다).
// 저장소 `.git/config`의 `remote.origin.url`/`insteadOf`는 에이전트가 바꿀 수 있어 완전히 막지 못한다.
// `pushurl`은 아래 `gitPushUrlConfig`로 확인해 있으면 자동 푸시를 하지 않는다. 시스템 설정은 실행기가 GIT_CONFIG_NOSYSTEM=1로 끈다.

const refspecOf = (b: string): string => `refs/heads/${b}:refs/heads/${b}`

export const gitSymbolicHead = (): string[] => [...GLOBAL_CONFIG, 'symbolic-ref', '-q', 'HEAD']
export const gitPushUrlConfig = (): string[] => [
  ...GLOBAL_CONFIG,
  'config',
  '--local',
  '--get-all',
  `remote.${REMOTE}.pushurl`
]
export const gitResolveBranch = (b: string): string[] => [
  ...GLOBAL_CONFIG,
  'rev-parse',
  '--verify',
  '--quiet',
  `refs/heads/${checkBranchName(b)}`
]
export const gitPush = (b: string): string[] => [
  ...GLOBAL_CONFIG,
  'push',
  REMOTE,
  refspecOf(checkBranchName(b))
]

const checkPr = (n: number): string => {
  if (!Number.isInteger(n) || n < 1 || n > 9_999_999)
    throw new GitArgError('PR 번호가 올바르지 않습니다.')
  return String(n)
}
export const ghPrView = (n: number): string[] => [
  'pr',
  'view',
  checkPr(n),
  '--json',
  'baseRefName,headRefName,headRefOid,state,isDraft'
]
/** 머지 방식은 merge commit 고정이고 검수한 head 커밋과 일치할 때만 합친다 (`--admin`, `--auto`, 브랜치 삭제 없음). */
export const ghPrMerge = (n: number, headSha: string): string[] => {
  if (!SHA_RE.test(headSha)) throw new GitArgError('커밋 해시가 올바르지 않습니다.')
  return ['pr', 'merge', checkPr(n), '--merge', '--match-head-commit', headSha]
}

const FORBIDDEN_FLAG =
  /^(-[a-zA-Z]*[fdD][a-zA-Z]*|--force.*|--delete|--mirror|--prune|--all|--tags|--follow-tags|--receive-pack.*|--exec.*|--repo.*|--no-verify|--admin|--auto|--delete-branch|--squash|--rebase|--amend|--hard)$/
const FORBIDDEN_SUBCOMMANDS = new Set([
  'reset',
  'rebase',
  'filter-branch',
  'filter-repo',
  'commit',
  'replace',
  'reflog',
  'gc',
  'clean',
  'checkout',
  'switch',
  'branch',
  'tag',
  'update-ref',
  'config',
  'remote'
])
const GIT_READ = new Set(['symbolic-ref', 'rev-parse'])

/**
 * 실행 직전 최종 확인. 허용되는 것은 (1) 고정 `-c` 3쌍 + 읽기 명령, (2) 고정 `-c` 3쌍 + `push origin refs/heads/X:refs/heads/X`,
 * (3) `gh pr view|merge`뿐이다. 강제·삭제·재작성 계열 인자와 `+`/`:` 로 시작하는 refspec은 예외로 거부한다.
 */
export function assertSafeArgs(command: 'git' | 'gh', args: readonly string[]): void {
  if (args.some((a) => typeof a !== 'string' || a.includes('\0') || /[\r\n]/.test(a)))
    throw new GitArgError('허용되지 않는 인자입니다.')
  if (command === 'gh') {
    if (args[0] !== 'pr' || (args[1] !== 'view' && args[1] !== 'merge'))
      throw new GitArgError('허용되지 않는 gh 명령입니다.')
    for (const a of args.slice(2))
      if (FORBIDDEN_FLAG.test(a)) throw new GitArgError('허용되지 않는 인자입니다.')
    return
  }
  const prefix = GLOBAL_CONFIG
  if (!prefix.every((v, i) => args[i] === v)) throw new GitArgError('허용되지 않는 git 설정입니다.')
  const rest = args.slice(prefix.length)
  const sub = rest[0]
  if (sub === 'config') {
    const want = gitPushUrlConfig().slice(prefix.length)
    if (rest.length !== want.length || !want.every((v, i) => rest[i] === v))
      throw new GitArgError('허용되지 않는 git 명령입니다.')
    return
  }
  if (sub === undefined || FORBIDDEN_SUBCOMMANDS.has(sub))
    throw new GitArgError('허용되지 않는 git 명령입니다.')
  if (sub === 'push') {
    const m = /^refs\/heads\/([^:+\s]+):refs\/heads\/([^:+\s]+)$/.exec(rest[2] ?? '')
    if (rest.length !== 3 || rest[1] !== REMOTE || m === null || m[1] !== m[2])
      throw new GitArgError('허용되지 않는 push 인자입니다.')
    checkBranchName(m[1])
    return
  }
  if (!GIT_READ.has(sub)) throw new GitArgError('허용되지 않는 git 명령입니다.')
  for (const a of rest.slice(1)) {
    if (FORBIDDEN_FLAG.test(a) || a.startsWith('+') || a.startsWith(':'))
      throw new GitArgError('허용되지 않는 인자입니다.')
  }
}
