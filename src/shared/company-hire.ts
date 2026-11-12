/** 첫 채용·PM 바로 채용(T-051) 계약. 직원 채용 자체는 T-035 `EmployeeService.create`가 한다. */
import type { ChangeRecord } from './employee-change'

/** 첫 채용 추천 팀. 순서가 채용 순서다 (pm이 먼저). */
export const FIRST_HIRE_ROLES = ['pm', 'developer'] as const
export type FirstHireRole = (typeof FIRST_HIRE_ROLES)[number]

export interface FirstHireRequest {
  /** 생략하면 pm, developer 모두. 중복 없이 허용 목록만 받는다. */
  roles?: FirstHireRole[]
}

export interface FirstHireResult {
  /** 이번 호출에서 채용한 직원 변경 기록 (채용 순서). */
  records: ChangeRecord[]
  /** 이미 있어 건너뛴 직원 id. */
  skipped: FirstHireRole[]
}

export interface HirePmResult {
  /** 채용된 PM의 직원 id. 프로젝트 `PM:` 지정은 호출 쪽이 `project:set-pm`(T-037)으로 한다. */
  employeeId: string
  record: ChangeRecord
}
