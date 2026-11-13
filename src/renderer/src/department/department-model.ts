import { departmentKey, validateDepartmentName } from '../../../shared/department'
import type { OrgMember, OrgSnapshot } from '../../../shared/org'
import type { DomainErrorCode } from '../../../shared/result'
import { deptToneFor, type DeptTone } from '../org/org-view'

export type DepartmentAction = 'add' | 'rename' | 'remove'

/** CEO 승인 없이 부서장으로 옮길 수 없는 기본 직원 id (main 규칙과 같다). */
const APPROVAL_IDS: readonly string[] = ['cto', 'cfo', 'hr']

/** main의 message는 노출하지 않고 코드별 고정 문장만 쓴다. */
export function departmentErrorText(code: DomainErrorCode, action: DepartmentAction): string {
  switch (code) {
    case 'approval-required':
      return 'CEO 승인이 필요해요. 결재함의 결정 카드에서 승인을 받은 뒤 다시 시도해 주세요.'
    case 'forbidden':
      return 'COO와 CEO가 있는 부서는 바꿀 수 없어요. 이 직원도 부서장으로 옮길 수 없어요.'
    case 'conflict':
      return action === 'remove'
        ? '부서에 직원이 있어서 지울 수 없어요. 직원을 다른 부서로 옮기거나 퇴사 처리한 뒤 다시 시도해 주세요.'
        : '같은 이름의 부서가 이미 있어요. 다른 이름을 써 주세요.'
    case 'invalid-request':
      return '입력한 내용을 확인해 주세요. 허용되지 않는 이름이에요.'
    case 'not-found':
      return '부서나 직원을 찾을 수 없어요. 조직도를 다시 불러온 뒤 시도해 주세요.'
    case 'no-company':
      return '열린 회사가 없어요.'
    case 'not-implemented':
      return '이 버전의 앱은 아직 이 기능을 지원하지 않아요.'
    default:
      return '처리하지 못했어요. 잠시 뒤 다시 시도해 주세요.'
  }
}

export interface DepartmentRow {
  name: string
  count: number
  tone: DeptTone
  /** 이름을 바꿀 수 없는 이유. 바꿀 수 있으면 null. */
  renameBlock: string | null
  /** 지울 수 없는 이유. 지울 수 있으면 null. */
  removeBlock: string | null
}

export function departmentRows(snapshot: OrgSnapshot): DepartmentRow[] {
  const filled = snapshot.org.departments.map((d) => d.name)
  const empties = (snapshot.emptyDepartments ?? []).filter((n) => !filled.includes(n))
  return [...filled, ...empties].map((name) => {
    const people = snapshot.org.members.filter((m) => m.department === name)
    return {
      name,
      count: people.length,
      tone: deptToneFor(name),
      renameBlock: people.some((m) => m.kind === 'human' || m.kind === 'main-session')
        ? 'COO와 CEO가 있는 부서는 이름을 바꿀 수 없어요.'
        : null,
      removeBlock:
        people.length > 0
          ? `직원이 ${people.length}명 있어요. 먼저 다른 부서로 옮기거나 퇴사 처리해 주세요.`
          : null
    }
  })
}

/** 이 부서 이름 변경에 CEO 승인이 필요한지 (cto·cfo·인사가 속한 부서). */
export function renameNeedsApproval(name: string, snapshot: OrgSnapshot): boolean {
  return snapshot.org.members.some(
    (m) => m.department === name && m.agentId !== null && APPROVAL_IDS.includes(m.agentId)
  )
}

/** 새 부서 이름 사전 검사. 최종 판정은 main이다. `except`는 이름 변경 때 자기 자신. */
export function validateNewName(
  name: string,
  snapshot: OrgSnapshot,
  except?: string
): string | null {
  const bad = validateDepartmentName(name)
  if (bad) return bad
  const key = departmentKey(name)
  const taken = departmentRows(snapshot).some(
    (r) => r.name !== except && departmentKey(r.name) === key
  )
  return taken ? '같은 이름의 부서가 이미 있어요.' : null
}

export function validateRename(from: string, to: string, snapshot: OrgSnapshot): string | null {
  if (to === from) return '지금 이름과 같아요.'
  return validateNewName(to, snapshot, from)
}

export interface LeadCandidate {
  member: OrgMember
  /** 선택할 수 없는 이유. 고를 수 있으면 null. */
  block: string | null
}

/** 부서장 후보: 직원 파일이 있는 직원. COO·CEO와 승인이 필요한 기본 직원은 고를 수 없다. */
export function leadCandidates(snapshot: OrgSnapshot): LeadCandidate[] {
  return snapshot.org.members
    .filter((m) => m.kind === 'agent' && m.agentId !== null)
    .map((member) => ({
      member,
      block:
        member.agentId !== null && APPROVAL_IDS.includes(member.agentId)
          ? 'CEO 승인이 필요해서 고를 수 없어요.'
          : null
    }))
}
