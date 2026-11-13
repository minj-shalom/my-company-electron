import type {
  PolicyAction,
  PolicyFlow,
  PolicyViolationCode,
  PolicyWarningCode
} from '../../../shared/policy'
import type { ProjectType } from '../../../shared/project'

/**
 * 프로젝트 유형별 화면 문구 사전 (D-024). 개발 프로젝트만 PR·머지·푸시·브랜치 용어를 쓰고,
 * 콘텐츠·기타는 같은 선택지를 쉬운 말로 보여 준다. 선택지(승인 모드)와 값의 의미는 유형과 무관하다.
 * 사전 밖에서 이 용어를 문자열로 직접 쓰지 않는다.
 */
export interface PolicyWording {
  actions: Record<PolicyAction, string>
  flows: Record<PolicyFlow, string>
  /** 프로젝트 카드의 git 정보 항목 이름. */
  gitBranchLabel: string
  protectedLabel: string
  usePrLabel: string
  prefixLabel: string
  baseLabel: string
  devGroupLegend: string
  reviewRequired: string
  immutableForce: string
  noPolicyFile: string
  autoConfirmForce: string
  autoProtectedWarn: string
  autoLimitHint: string
  pushPrefixLabel: string
  pushPrefixHint: string
  mergeTargetLabel: string
  mergeTargetHint: string
  protectedGroupLabel: string
  protectedDanger: string
  badgeProtected: string
  describePush: (targets: string, limit: number | undefined) => string
  describeMerge: (targets: string, limit: number | undefined) => string
  limitSummary: string
  targetMissing: string
  pushTargetInvalid: string
  requirement: string
  protectedUnconfirmed: string
  protectedLimit: string
  warnRequirement: string
  warnProtectedLimit: string
  warnProtectedUnconfirmed: string
  checkPushTarget: string
  checkMergeTarget: string
  checkMergeRequirement: string
  checkProtectedLimit: (max: number) => string
  checkProtectedConfirm: string
}

const DEVELOPMENT: PolicyWording = {
  actions: { push: '푸시', merge: '머지', publish: '발행', 'draft-approve': '초안 승인' },
  flows: {
    'dev-git-pr': '개발 (feature 브랜치 → PR)',
    'content-draft-approve': '콘텐츠 (초안 → 승인 → 발행)',
    custom: '직접 정하기'
  },
  gitBranchLabel: '브랜치',
  protectedLabel: '보호 브랜치',
  usePrLabel: 'PR을 사용해요',
  prefixLabel: '브랜치 접두어',
  baseLabel: '기반 브랜치',
  devGroupLegend: '개발 흐름',
  reviewRequired: 'reviewer-qa 필수',
  immutableForce: '강제 푸시와 히스토리 재작성은 자동 모드에서도 할 수 없어요.',
  noPolicyFile: '모든 푸시·머지·발행·승인은',
  autoConfirmForce:
    '일일 상한, 감사 기록, 킬 스위치는 항상 적용돼요. 강제 푸시와 프로젝트 밖 쓰기는 자동 모드에서도 안 돼요.',
  autoProtectedWarn:
    '보호 브랜치 머지가 포함돼 있어요. 잘못 머지되면 바로 릴리스에 반영될 수 있어요.',
  autoLimitHint: '푸시 50, 머지 10, 발행 20',
  pushPrefixLabel: '자동 푸시를 허용할 브랜치 접두어',
  pushPrefixHint: '쉼표로 여러 개를 적을 수 있어요. master, main 같은 보호 브랜치는 안 돼요.',
  mergeTargetLabel: '자동 머지를 허용할 브랜치 (이름으로 정확히)',
  mergeTargetHint: 'PR이 있고 reviewer-qa 검수를 통과한 것만 머지돼요.',
  protectedGroupLabel: '보호 브랜치 확인',
  protectedDanger:
    '보호 브랜치(master, main 등)에 컨펌 없이 머지돼요. 릴리스에 바로 반영될 수 있어요. 하루 1~2회까지만 허용돼요.',
  badgeProtected: '보호 브랜치 포함',
  describePush: (t, n) => `${t} 브랜치를 하루 최대 ${n}회까지 컨펌 없이 푸시해요.`,
  describeMerge: (t, n) =>
    `${t}로 가는 PR을 하루 최대 ${n}회까지 컨펌 없이 머지해요 (PR과 reviewer-qa 통과 필수).`,
  limitSummary: '일일 상한이 허용 범위를 넘었어요 (푸시 50, 머지 10, 발행 20 이하).',
  targetMissing: '자동 모드에는 허용 대상(브랜치)이 필요해요.',
  pushTargetInvalid: '허용 대상으로 쓸 수 없는 브랜치예요. 푸시는 feature/ 같은 접두어만 돼요.',
  requirement:
    '자동 머지에는 PR 사용과 reviewer-qa 필수가 필요해요. 자동 발행에는 발행 어댑터가 필요해요.',
  protectedUnconfirmed: '보호 브랜치 자동 머지는 프로젝트 이름을 정확히 입력해야 해요.',
  protectedLimit: '보호 브랜치 자동 머지는 하루 1~2회까지만 허용돼요.',
  warnRequirement: 'PR 사용·검수 필수·발행 어댑터 요건이 빠져 "매번 컨펌"으로 대체했어요.',
  warnProtectedLimit: '보호 브랜치 머지 상한이 1~2회가 아니라 "매번 컨펌"으로 대체했어요.',
  warnProtectedUnconfirmed: '보호 브랜치 자동 머지의 이름 확인이 없어 "매번 컨펌"으로 대체했어요.',
  checkPushTarget: '푸시: 허용할 브랜치 접두어를 하나 이상 입력해 주세요.',
  checkMergeTarget: '머지: 허용할 브랜치를 하나 이상 입력해 주세요.',
  checkMergeRequirement: '머지: 자동 머지에는 PR 사용과 "reviewer-qa 필수"가 필요해요.',
  checkProtectedLimit: (max) => `머지: 보호 브랜치는 하루 1~${max}회까지만 허용돼요.`,
  checkProtectedConfirm: '머지: 보호 브랜치 자동 머지는 프로젝트 이름을 정확히 입력해야 해요.'
}

const EASY: PolicyWording = {
  actions: {
    push: '작업 공유',
    merge: '최종본 반영',
    publish: '발행',
    'draft-approve': '초안 승인'
  },
  flows: {
    'dev-git-pr': '개발 (작업 버전을 나눠 검토 후 반영)',
    'content-draft-approve': '콘텐츠 (초안 → 승인 → 발행)',
    custom: '직접 정하기'
  },
  gitBranchLabel: '작업 버전',
  protectedLabel: '최종본',
  usePrLabel: '반영 전에 검토 요청을 올려요',
  prefixLabel: '작업 버전 이름 앞부분',
  baseLabel: '기준 작업 버전',
  devGroupLegend: '작업 반영 방식',
  reviewRequired: '검수 담당 필수',
  immutableForce: '이미 공유한 작업을 되돌리거나 기록을 지우는 일은 자동 모드에서도 할 수 없어요.',
  noPolicyFile: '모든 작업 공유·최종본 반영·발행·승인은',
  autoConfirmForce:
    '일일 상한, 감사 기록, 킬 스위치는 항상 적용돼요. 이미 공유한 작업을 되돌리는 일과 프로젝트 밖 쓰기는 자동 모드에서도 안 돼요.',
  autoProtectedWarn: '최종본 반영이 포함돼 있어요. 잘못 반영되면 바로 결과물에 나타날 수 있어요.',
  autoLimitHint: '작업 공유 50, 최종본 반영 10, 발행 20',
  pushPrefixLabel: '자동 공유를 허용할 작업 버전 이름 앞부분',
  pushPrefixHint: '쉼표로 여러 개를 적을 수 있어요. 최종본으로 쓰는 이름은 안 돼요.',
  mergeTargetLabel: '자동 반영을 허용할 작업 버전 (이름으로 정확히)',
  mergeTargetHint: '검토 요청이 있고 검수 담당이 통과한 것만 반영돼요.',
  protectedGroupLabel: '최종본 확인',
  protectedDanger:
    '최종본에 컨펌 없이 반영돼요. 결과물에 바로 나타날 수 있어요. 하루 1~2회까지만 허용돼요.',
  badgeProtected: '최종본 포함',
  describePush: (t, n) => `${t}로 시작하는 작업 버전을 하루 최대 ${n}회까지 컨펌 없이 공유해요.`,
  describeMerge: (t, n) =>
    `${t}로 가는 변경을 하루 최대 ${n}회까지 컨펌 없이 반영해요 (검토 요청과 검수 담당 통과 필수).`,
  limitSummary: '일일 상한이 허용 범위를 넘었어요 (작업 공유 50, 최종본 반영 10, 발행 20 이하).',
  targetMissing: '자동 모드에는 허용 대상(작업 버전)이 필요해요.',
  pushTargetInvalid:
    '허용 대상으로 쓸 수 없는 이름이에요. 최종본이 아닌 작업용 이름의 앞부분만 쓸 수 있어요.',
  requirement:
    '자동 반영에는 검토 요청과 검수 담당 필수가 필요해요. 자동 발행에는 발행 어댑터가 필요해요.',
  protectedUnconfirmed: '최종본 자동 반영은 프로젝트 이름을 정확히 입력해야 해요.',
  protectedLimit: '최종본 자동 반영은 하루 1~2회까지만 허용돼요.',
  warnRequirement: '검토 요청·검수 필수·발행 어댑터 요건이 빠져 "매번 컨펌"으로 대체했어요.',
  warnProtectedLimit: '최종본 반영 상한이 1~2회가 아니라 "매번 컨펌"으로 대체했어요.',
  warnProtectedUnconfirmed: '최종본 자동 반영의 이름 확인이 없어 "매번 컨펌"으로 대체했어요.',
  checkPushTarget: '작업 공유: 허용할 작업 버전 이름 앞부분을 하나 이상 입력해 주세요.',
  checkMergeTarget: '최종본 반영: 허용할 작업 버전을 하나 이상 입력해 주세요.',
  checkMergeRequirement: '최종본 반영: 자동 반영에는 검토 요청과 "검수 담당 필수"가 필요해요.',
  checkProtectedLimit: (max) => `최종본 반영: 최종본은 하루 1~${max}회까지만 허용돼요.`,
  checkProtectedConfirm: '최종본 반영: 최종본 자동 반영은 프로젝트 이름을 정확히 입력해야 해요.'
}

export const wordingFor = (type: ProjectType): PolicyWording =>
  type === 'development' ? DEVELOPMENT : EASY

/** 코드별 문구 중 용어가 들어간 것만 사전에서 덮어쓴다. */
export function violationOverride(w: PolicyWording, code: PolicyViolationCode): string | null {
  switch (code) {
    case 'auto-limit-exceeded':
      return w.limitSummary
    case 'auto-target-missing':
      return w.targetMissing
    case 'auto-target-invalid':
      return w.pushTargetInvalid
    case 'auto-requirement-missing':
      return w.requirement
    case 'protected-merge-unconfirmed':
      return w.protectedUnconfirmed
    case 'protected-limit-exceeded':
      return w.protectedLimit
    default:
      return null
  }
}

export function warningOverride(w: PolicyWording, code: PolicyWarningCode): string | null {
  switch (code) {
    case 'auto-requirement-missing':
      return w.warnRequirement
    case 'protected-limit-exceeded':
      return w.warnProtectedLimit
    case 'protected-merge-unconfirmed':
      return w.warnProtectedUnconfirmed
    default:
      return null
  }
}
