/** 변경 감사 기록의 공통 필드. 직원(T-035)과 프로젝트(T-037) 기록이 같은 모양을 쓴다. */
import type { EmployeeActor } from './employee-change'

export interface ChangeRecordBase {
  actor: EmployeeActor
  /** 승인된 결정 카드 번호. 프로젝트 변경은 카드가 필요 없어 항상 null. */
  approval: string | null
  /** ISO 8601. */
  at: string
}
