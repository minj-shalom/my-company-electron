import type { DecisionKind } from '../../../shared/decision'
import {
  PROPOSAL_FAILURE_CODES,
  type ProposalAction,
  type ProposalApplyStatus,
  type ProposalFailureCode
} from '../../../shared/proposal'
import { parseProposalBlock, type BlockFailure } from '../../../shared/proposal-block'

/** 결과 코드별 고정 문장. main 메시지는 쓰지 않는다. */
export const PROPOSAL_FAILURE_TEXT: Record<ProposalFailureCode, string> = {
  'not-actionable':
    '이 카드는 앱이 처리할 수 없는 형식이에요. 내용을 확인하고 거절하거나 다시 제안받아 주세요.',
  stale: '제안한 뒤 대상이 바뀌어 적용하지 않았어요. 다시 제안을 받아 주세요.',
  protected: 'CEO·COO 행이나 불변 정책을 바꾸는 변경이라 적용하지 않았어요.',
  'rejected-by-rule': '조직 규칙(중복, 순환 등)에 어긋나 적용하지 않았어요.',
  'hash-mismatch': '적용 결과가 승인한 내용과 달라 반영하지 않았어요.',
  busy: '다른 작업이 진행 중이에요. 잠시 뒤 다시 시도해 주세요.',
  'rollback-failed':
    '적용에 실패했고 원상 복구도 실패했어요. 직원 파일과 조직도 상태를 직접 확인해 주세요.',
  failed: '처리하지 못했어요. 잠시 뒤 다시 시도해 주세요.'
}

export function proposalFailureText(code: unknown): string {
  const known = PROPOSAL_FAILURE_CODES.find((c) => c === code)
  return known ? PROPOSAL_FAILURE_TEXT[known] : PROPOSAL_FAILURE_TEXT.failed
}

export const PROPOSAL_SUCCESS_TEXT: Record<ProposalApplyStatus, string> = {
  applied: '변경을 적용했어요.',
  'approved-pending-edit': '승인을 기록했어요. 인사(hr)가 같은 내용으로 파일을 고치면 반영돼요.',
  rejected: '거절했어요. 변경하지 않았어요.',
  'already-applied': '이미 적용된 카드예요.',
  'already-rejected': '이미 거절된 카드예요.',
  restored: '마지막 정상 상태로 복원했어요.',
  accepted: '변경을 사후 승인하고 격리를 해제했어요.',
  dismissed: '확인했어요. 현재 상태를 그대로 두었어요.'
}

/** 코드는 카드 처리 후 pending에 남는지가 다르다: stale 등 상태가 바뀐 경우는 목록을 다시 읽는다. */
export function shouldRefreshAfterApplyFailure(code: ProposalFailureCode): boolean {
  return code === 'stale' || code === 'rollback-failed' || code === 'not-actionable'
}

export function usesApplyApi(kind: DecisionKind): boolean {
  return kind === 'proposal' || kind === 'integrity-warning' || kind === 'revert-suggestion'
}

// ---- 본문 분해 ----

export type QuestionSegment =
  | { type: 'text'; text: string }
  | { type: 'proposal'; actions: ProposalAction[] }
  | { type: 'invalid'; reason: BlockFailure }

const FENCE_OPEN = /^```proposal[ \t]*$/
const FENCE_CLOSE = /^```[ \t]*$/
const MAX_FENCE_LINES = 400

/** 질문 본문에서 `proposal` 펜스를 떼어 내고 파서(shared)로 검증한다. 닫히지 않은 펜스는 일반 텍스트로 둔다. */
export function splitQuestion(question: string): QuestionSegment[] {
  const lines = question.split(/\r?\n/)
  const out: QuestionSegment[] = []
  let text: string[] = []
  const flush = (): void => {
    const t = text.join('\n').trim()
    if (t) out.push({ type: 'text', text: t })
    text = []
  }
  for (let i = 0; i < lines.length; i += 1) {
    if (!FENCE_OPEN.test(lines[i])) {
      text.push(lines[i])
      continue
    }
    let end = -1
    for (let j = i + 1; j < lines.length && j <= i + MAX_FENCE_LINES; j += 1) {
      if (FENCE_CLOSE.test(lines[j])) {
        end = j
        break
      }
    }
    if (end < 0) {
      text.push(lines[i])
      continue
    }
    flush()
    const parsed = parseProposalBlock(lines.slice(i + 1, end).join('\n'))
    out.push(
      parsed.ok
        ? { type: 'proposal', actions: parsed.actions }
        : { type: 'invalid', reason: parsed.reason }
    )
    i = end
  }
  flush()
  return out
}

/** 적용 가능한 카드인가: 파싱 실패한 블록이 있거나 블록이 하나도 없으면 승인할 수 없다. */
export function isApprovable(segments: readonly QuestionSegment[]): boolean {
  const hasBlock = segments.some((s) => s.type === 'proposal')
  return hasBlock && !segments.some((s) => s.type === 'invalid')
}

// ---- 액션 행 ----

export interface ActionRow {
  label: string
  value: string
  /** 권한 확대 등 CEO가 꼭 봐야 하는 값. */
  strong?: boolean
}

export interface ActionView {
  title: string
  rows: ActionRow[]
  /** 도구에 Bash 추가나 모델 변경이 있다. */
  escalation: boolean
}

const hasBash = (tools: readonly string[]): boolean => tools.some((t) => /^bash\b/i.test(t.trim()))

const shortHash = (h: string): string => `${h.slice(0, 12)}…`

export function actionView(a: ProposalAction): ActionView {
  const rows: ActionRow[] = []
  const push = (label: string, value: string | undefined, strong = false): void => {
    if (value !== undefined) rows.push({ label, value, strong })
  }
  switch (a.action) {
    case 'assign':
    case 'unassign':
      push('프로젝트', a.project)
      push('직원', a.employee)
      return {
        title: a.action === 'assign' ? '프로젝트 배정' : '프로젝트 배정 해제',
        rows,
        escalation: false
      }
    case 'hire':
      push('직원 id', a.id)
      push('템플릿', a.template)
      push('부서', a.department)
      push('보고 대상', a.reportsTo)
      push('직급', a.title)
      push('역할', a.role)
      return { title: '직원 채용', rows, escalation: false }
    case 'update': {
      const bash = a.tools !== undefined && hasBash(a.tools)
      push('직원 id', a.id)
      push('변경 후 설명', a.description)
      push('변경 후 모델', a.model, true)
      push('변경 후 도구', a.tools?.join(', '), bash)
      if (bash) push('권한 확대', 'Bash 실행 권한이 포함돼요', true)
      push('기준 해시', a.base && shortHash(a.base))
      push('승인 해시', a.after && shortHash(a.after))
      return { title: '직원 파일 수정', rows, escalation: bash || a.model !== undefined }
    }
    case 'move':
      push('직원 id', a.id)
      push('변경 후 부서', a.department)
      push('변경 후 보고 대상', a.reportsTo)
      push('변경 후 직급', a.title)
      push('변경 후 역할', a.role)
      return { title: '부서·보고 라인 변경', rows, escalation: false }
    case 'retire':
      push('직원 id', a.id, true)
      return { title: '퇴사 처리', rows, escalation: false }
    case 'policy-change':
      push('프로젝트', a.project)
      push('정책 개정 번호', a.revision)
      push('변경 후 값', JSON.stringify(a.values, null, 2) ?? '', true)
      return { title: '정책 변경', rows, escalation: false }
  }
}

export function blockFailureText(reason: BlockFailure): string {
  return reason === 'protected'
    ? '보호 대상(CEO·COO)을 건드리는 변경이 들어 있어요.'
    : '알 수 없거나 형식이 맞지 않는 변경이 들어 있어 적용 버튼을 막았어요. 거절하거나 다시 제안받아 주세요.'
}

/** 되돌리기 카드의 격리 중 직원. 앱이 쓴 `격리된 직원(a, b)` 문구에서만 읽고 id 형식만 받는다. */
export function quarantinedEmployees(text: string): string[] {
  const m = /격리된 직원\(([^)]{1,1000})\)/.exec(text)
  if (!m) return []
  return m[1]
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^[a-z0-9][a-z0-9-]{0,49}$/.test(s))
    .slice(0, 20)
}
