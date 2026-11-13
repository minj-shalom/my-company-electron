/** 부서 생성·이름 변경·삭제(T-040) 계약. 부서는 직원의 부서 값으로만 존재하며 원본은 `company/org.md`다. */
import type { ChangeRecordBase } from './change-record'
import type { SensitiveReason } from './employee-change'

export const DEPARTMENT_NAME_MAX = 30

// 표 구분(`|`), 마크다운(`` ` \ * _ ~ # > [ ] < { } ! ``), 조직도 블록(`( ) │ ├ └ ──`), 목록 구분(`, ; / 、`), 표 구분선(`:`)을 거부한다.
// 이스케이프하지 않고 거부하는 이유: 이름이 표 셀과 조직도 블록 줄에 그대로 쓰여 왕복이 깨지기 쉽다.
const FORBIDDEN = /[|`\\*_~#>[\]<>{}!():,;/、│├└─]/
// eslint-disable-next-line no-control-regex -- 제어 문자 검출이 목적
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/
// 서식 문자(제로폭 등)와 일반 공백이 아닌 공백은 눈에 보이지 않아 같은 이름처럼 보이는 우회에 쓰인다.
const INVISIBLE = /[\p{Cf}\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/u
const RESERVED = new Set(['-', 'ceo', 'coo', '없음', '사용자', '조직도', '직원목록'])

/** 중복·예약어 비교용 키. 전각, 대소문자, 공백 변형으로 같은 이름을 우회하지 못하게 한다. */
export function departmentKey(name: string): string {
  return name
    .normalize('NFKC')
    .replace(/[\p{Cf}\p{Z}\s]/gu, '')
    .toLowerCase()
}

/** 문제가 있으면 한국어 사유, 없으면 null. renderer 사전 검사와 main 검증이 같은 함수를 쓴다. */
export function validateDepartmentName(name: unknown): string | null {
  if (typeof name !== 'string' || name.length === 0) return '부서 이름을 입력하세요.'
  if (name.length > DEPARTMENT_NAME_MAX)
    return `부서 이름은 ${DEPARTMENT_NAME_MAX}자 이하여야 합니다.`
  if (name !== name.trim()) return '부서 이름 앞뒤에 공백을 둘 수 없습니다.'
  if (CONTROL.test(name)) return '부서 이름에 제어 문자를 쓸 수 없습니다.'
  if (INVISIBLE.test(name)) return '부서 이름에 보이지 않는 문자를 쓸 수 없습니다.'
  if (FORBIDDEN.test(name)) return '부서 이름에 쓸 수 없는 기호가 있습니다.'
  if (/^[-+.]/.test(name)) return '부서 이름은 기호로 시작할 수 없습니다.'
  if (RESERVED.has(departmentKey(name))) return '예약된 이름이라 쓸 수 없습니다.'
  return null
}

export interface DepartmentAddRequest {
  name: string
  /**
   * 부서장이 될 직원 id. 먼저 `employee:create`로 채용한 직원 중에서 고른다 (부서는 소속 직원이 있어야 표에 나타난다).
   * 이 직원이 새 부서로 옮겨진다. COO·CEO는 거부, cto·cfo·hr는 승인 카드가 필요하다.
   */
  leadId: string
  approval?: string
}

export interface DepartmentRenameRequest {
  from: string
  to: string
  /** cto·cfo·hr가 속한 부서면 필수. COO·CEO가 속한 부서는 승인이 있어도 거부한다. */
  approval?: string
}

/** 직원이 0명인 부서만 지운다. */
export interface DepartmentRemoveRequest {
  name: string
  approval?: string
}

export type DepartmentChangeAction = 'add' | 'rename' | 'remove'

/** T-046 감사 줄용 변경 기록. `actor`와 `approval`, `at`은 직원 변경 기록(T-035)과 같은 규칙이다. */
export interface DepartmentChangeRecord extends ChangeRecordBase {
  action: DepartmentChangeAction
  /** 대상 부서 이름. 이름 변경이면 변경 전 이름. */
  department: string
  /** 이름 변경 후 이름. 그 외는 null. */
  newName: string | null
  /** 소속이 바뀐 직원 id (추가: 부서장, 이름 변경: 소속 전원, 삭제: 없음). */
  affectedEmployeeIds: string[]
  sensitive: boolean
  sensitiveReasons: SensitiveReason[]
  /** 회사 폴더 기준 상대 경로. */
  files: string[]
}

export interface DepartmentChangeResult {
  record: DepartmentChangeRecord
}
