import type { WindowApi } from '../../../shared/api'
import type { DomainErrorCode } from '../../../shared/result'
import {
  isProtectedBranch,
  LIMITED_ACTIONS,
  MAX_DAILY_LIMIT,
  PROTECTED_MERGE_MAX_DAILY,
  type ApprovalMode,
  type LimitedAction,
  type PolicyAction,
  type PolicyFlow,
  type PolicyHistoryEntry,
  type PolicySaveRequest,
  type PolicyState,
  type PolicySummary,
  type PolicyValues,
  type PolicyViolationCode,
  type PolicyWarningCode
} from '../../../shared/policy'
import type { ProjectType } from '../../../shared/project'
import type { BadgeTone } from '../ui/Badge'
import { violationOverride, warningOverride, wordingFor } from './policy-wording'

export const flowLabels = (type: ProjectType): Record<PolicyFlow, string> => wordingFor(type).flows

export const actionLabels = (type: ProjectType): Record<PolicyAction, string> =>
  wordingFor(type).actions

export const MODE_LABELS: Record<ApprovalMode, string> = {
  every: '매번 컨펌',
  batch: '묶음 컨펌',
  auto: '자동 (컨펌 없음)'
}

export const MODE_HINTS: Record<ApprovalMode, string> = {
  every: '기본값이에요. 할 때마다 CEO가 확인해요.',
  batch: '모아서 한 번에 확인해요.',
  auto: '위험: CEO 컨펌 없이 실행돼요. 일일 상한과 허용 대상 안에서만 움직여요.'
}

/** 흐름에 따라 보여 줄 동작. 직접 정하기는 모두 보인다. */
export function visibleActions(flow: PolicyFlow): PolicyAction[] {
  if (flow === 'dev-git-pr') return ['push', 'merge']
  if (flow === 'content-draft-approve') return ['publish', 'draft-approve']
  return ['push', 'merge', 'publish', 'draft-approve']
}

/** 항상 지켜지는 규칙 안내 (읽기 전용). */
export const immutableRules = (type: ProjectType = 'development'): readonly string[] => [
  wordingFor(type).immutableForce,
  '등록된 프로젝트 폴더와 회사 폴더 밖에는 쓰지 않아요.',
  '프로젝트 폴더를 지우거나 옮기지 않아요.',
  '로그인 정보와 발행 토큰은 AI 직원에게 보이지 않아요.',
  '정책 파일은 AI 직원이 직접 고칠 수 없어요. 변경은 CEO 화면이나 승인된 제안으로만 해요.',
  '자동 모드에는 일일 상한, 감사 기록, 킬 스위치가 항상 붙어요.'
]

/** 서버 message는 보여 주지 않고 코드별 고정 문구만 쓴다. */
const VIOLATION_TEXT: Record<PolicyViolationCode, string> = {
  'immutable-relaxed': '항상 지켜지는 규칙을 풀려는 값이라 저장할 수 없어요.',
  'auto-needs-ceo': '자동 모드는 CEO 화면에서만 켤 수 있어요.',
  'auto-needs-confirm': '자동 모드는 경고를 확인한 뒤에만 저장할 수 있어요.',
  'auto-limit-missing': '자동 모드에는 일일 상한이 필요해요.',
  'auto-limit-exceeded': '일일 상한이 허용 범위를 넘었어요 (푸시 50, 머지 10, 발행 20 이하).',
  'auto-target-missing': '자동 모드에는 허용 대상(브랜치)이 필요해요.',
  'auto-target-invalid': '허용 대상으로 쓸 수 없는 브랜치예요. 푸시는 feature/ 같은 접두어만 돼요.',
  'auto-requirement-missing':
    '자동 머지에는 PR 사용과 reviewer-qa 필수가 필요해요. 자동 발행에는 발행 어댑터가 필요해요.',
  'protected-merge-unconfirmed': '보호 브랜치 자동 머지는 프로젝트 이름을 정확히 입력해야 해요.',
  'protected-limit-exceeded': '보호 브랜치 자동 머지는 하루 1~2회까지만 허용돼요.',
  'invalid-value': '허용되지 않는 값이 있어요. 입력을 확인해 주세요.',
  'file-too-large': '정책 내용이 너무 길어요. 메모를 줄여 주세요.'
}

const WARNING_TEXT: Record<PolicyWarningCode, string> = {
  'invalid-value': '허용되지 않는 값이 있어 기본값으로 대체했어요.',
  'duplicate-field': '같은 항목이 두 번 적혀 있어요.',
  'immutable-relaxed': '항상 지켜지는 규칙을 푸는 줄이 있어 무시했어요.',
  'auto-not-activated': '자동 모드 활성화 기록이 없어 "매번 컨펌"으로 대체했어요.',
  'auto-activation-stale': '활성화 뒤 설정이 손으로 바뀌어 "매번 컨펌"으로 대체했어요.',
  'auto-limit-missing': '자동 모드에 일일 상한이 없어 "매번 컨펌"으로 대체했어요.',
  'auto-limit-exceeded': '일일 상한이 허용 범위를 넘어 "매번 컨펌"으로 대체했어요.',
  'auto-target-missing': '자동 모드에 허용 대상이 없어 "매번 컨펌"으로 대체했어요.',
  'auto-target-invalid': '허용 대상이 올바르지 않아 "매번 컨펌"으로 대체했어요.',
  'auto-requirement-missing':
    'PR 사용·검수 필수·발행 어댑터 요건이 빠져 "매번 컨펌"으로 대체했어요.',
  'protected-limit-exceeded': '보호 브랜치 머지 상한이 1~2회가 아니라 "매번 컨펌"으로 대체했어요.',
  'protected-merge-unconfirmed':
    '보호 브랜치 자동 머지의 이름 확인이 없어 "매번 컨펌"으로 대체했어요.',
  'file-unreadable': '정책 파일을 읽지 못해 기본값을 보여 줘요.'
}

export const violationText = (
  code: PolicyViolationCode,
  type: ProjectType = 'development'
): string => violationOverride(wordingFor(type), code) ?? VIOLATION_TEXT[code]
export const warningText = (code: PolicyWarningCode, type: ProjectType = 'development'): string =>
  warningOverride(wordingFor(type), code) ?? WARNING_TEXT[code]

/** 같은 문구는 한 번만. */
export function uniqueMessages(texts: string[]): string[] {
  return [...new Set(texts)]
}

export { isProtectedBranch }

export const hasProtectedTarget = (branches: string[]): boolean => branches.some(isProtectedBranch)

/** 쉼표·공백·줄바꿈으로 나눈 목록. 중복과 빈 항목은 버린다. */
export function parseList(text: string): string[] {
  return [...new Set(text.split(/[\s,]+/).filter((s) => s.length > 0))].slice(0, 20)
}

export const listText = (items: string[]): string => items.join(', ')

const isLimited = (a: PolicyAction): a is LimitedAction =>
  (LIMITED_ACTIONS as readonly string[]).includes(a)

const sameList = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i])

/** 경고 대화가 필요한 동작: 자동을 새로 켜거나 자동 설정(상한, 허용 대상, 이름 확인)이 바뀐 동작. */
export function autoChanges(initial: PolicyValues, draft: PolicyValues): PolicyAction[] {
  return (Object.keys(draft.modes) as PolicyAction[]).filter((a) => {
    if (draft.modes[a] !== 'auto') return false
    if (initial.modes[a] !== 'auto') return true
    if (isLimited(a) && initial.dailyLimits[a] !== draft.dailyLimits[a]) return true
    if (a === 'push' && !sameList(initial.autoPushPrefixes, draft.autoPushPrefixes)) return true
    if (a === 'merge') {
      return (
        !sameList(initial.autoMergeBranches, draft.autoMergeBranches) ||
        initial.confirmInput !== draft.confirmInput
      )
    }
    return false
  })
}

/** 저장 전에 화면에서 먼저 잡는 입력 오류 (서버가 다시 검증한다). */
export function checkDraft(
  draft: PolicyValues,
  projectName: string,
  type: ProjectType = 'development'
): string[] {
  const w = wordingFor(type)
  const out: string[] = []
  for (const a of LIMITED_ACTIONS) {
    if (draft.modes[a] !== 'auto') continue
    const limit = draft.dailyLimits[a]
    const label = w.actions[a]
    if (limit === undefined || !Number.isInteger(limit) || limit < 1)
      out.push(`${label}: 일일 상한을 1 이상의 정수로 입력해 주세요.`)
    else if (limit > MAX_DAILY_LIMIT[a])
      out.push(`${label}: 일일 상한은 ${MAX_DAILY_LIMIT[a]} 이하여야 해요.`)
  }
  if (draft.modes.push === 'auto' && draft.autoPushPrefixes.length === 0)
    out.push(w.checkPushTarget)
  if (draft.modes.merge === 'auto') {
    if (draft.autoMergeBranches.length === 0) out.push(w.checkMergeTarget)
    if (!draft.usePr || draft.reviewStage !== 'required') out.push(w.checkMergeRequirement)
    if (hasProtectedTarget(draft.autoMergeBranches)) {
      const limit = draft.dailyLimits.merge
      if (limit !== undefined && limit > PROTECTED_MERGE_MAX_DAILY)
        out.push(w.checkProtectedLimit(PROTECTED_MERGE_MAX_DAILY))
      if (draft.confirmInput !== projectName) out.push(w.checkProtectedConfirm)
    }
  }
  return out
}

/** 프로젝트 목록 배지. 자동 모드가 하나도 없으면 null. */
export function policyBadge(
  s: PolicySummary | undefined,
  type: ProjectType = 'development'
): { label: string; tone: BadgeTone } | null {
  if (!s || s.autoActions.length === 0) return null
  const w = wordingFor(type)
  const names = s.autoActions.map((a) => w.actions[a]).join('·')
  return s.protectedMergeEnabled
    ? { label: `자동 ${names} (${w.badgeProtected})`, tone: 'bad' }
    : { label: `자동 ${names}`, tone: 'warn' }
}

/** 변경 이력은 최신이 위로 보이게 뒤집는다. */
export const latestFirst = (h: PolicyHistoryEntry[]): PolicyHistoryEntry[] => [...h].reverse()

export function formatAt(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function setMode(
  draft: PolicyValues,
  action: PolicyAction,
  mode: ApprovalMode
): PolicyValues {
  const next: PolicyValues = { ...draft, modes: { ...draft.modes, [action]: mode } }
  // 자동 머지의 필수 요건(PR, 검수 필수)은 켤 때 같이 맞춰 저장 거부를 줄인다. 상한과 대상은 사용자가 직접 정한다.
  if (mode === 'auto' && action === 'merge') {
    next.usePr = true
    next.reviewStage = 'required'
  }
  return next
}

export type PolicyLoad =
  { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; state: PolicyState }

export type SaveStatus =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'violations'; messages: string[] }
  | { kind: 'error'; message: string }
  | { kind: 'conflict' }

const FAILURE_TEXT: Partial<Record<DomainErrorCode, string>> = {
  'not-found': '이 프로젝트의 정책을 찾을 수 없어요. 프로젝트 목록을 새로 고쳐 보세요.',
  'invalid-request': '입력 형식이 올바르지 않아요. 값을 확인해 주세요.',
  'no-company': '열린 회사가 없어요.',
  'not-implemented': '이 환경에서는 아직 지원하지 않아요.'
}

/** API 실패는 코드별 고정 문구로만 보여 준다. */
export const failureText = (code: DomainErrorCode): string =>
  FAILURE_TEXT[code] ?? '일시적인 문제로 처리하지 못했어요. 잠시 뒤 다시 시도해 주세요.'

export async function loadPolicy(api: WindowApi, projectId: string): Promise<PolicyLoad> {
  try {
    const r = await api.getPolicy({ projectId })
    return r.ok
      ? { kind: 'ready', state: r.value }
      : { kind: 'error', message: failureText(r.code) }
  } catch {
    return { kind: 'error', message: failureText('internal') }
  }
}

/** 저장 결과를 화면 상태로 바꾼다. 성공하면 새 state도 돌려준다. */
export async function submitPolicy(
  api: WindowApi,
  req: PolicySaveRequest,
  type: ProjectType = 'development'
): Promise<{ status: SaveStatus; state?: PolicyState }> {
  try {
    const r = await api.savePolicy(req)
    if (!r.ok)
      return {
        status:
          r.code === 'conflict'
            ? { kind: 'conflict' }
            : { kind: 'error', message: failureText(r.code) }
      }
    if (r.value.saved) return { status: { kind: 'saved' }, state: r.value.state }
    return {
      status: {
        kind: 'violations',
        messages: uniqueMessages(r.value.violations.map((v) => violationText(v.code, type)))
      }
    }
  } catch {
    return { status: { kind: 'error', message: failureText('internal') } }
  }
}

/** 이 동작이 컨펌 없이 무엇을 하는지. 값은 React 텍스트로만 렌더링한다. */
export function describeAuto(
  action: PolicyAction,
  d: PolicyValues,
  type: ProjectType = 'development'
): string {
  const w = wordingFor(type)
  const limit = d.dailyLimits[action as 'push' | 'merge' | 'publish']
  switch (action) {
    case 'push':
      return w.describePush(listText(d.autoPushPrefixes), limit)
    case 'merge':
      return w.describeMerge(listText(d.autoMergeBranches), limit)
    case 'publish':
      return `콘텐츠를 하루 최대 ${limit}건까지 컨펌 없이 발행해요.`
    case 'draft-approve':
      return 'CEO 승인 없이 초안이 발행 단계로 넘어가요.'
  }
}
