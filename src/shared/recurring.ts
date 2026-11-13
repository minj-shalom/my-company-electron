/** 반복 업무(T-049) 계약. 원본은 회사 폴더의 `company/recurring.md`이고 이 구조는 파생물이다. */

export const RECURRING_ID = /^[a-z0-9][a-z0-9-]{0,39}$/
export const MAX_RECURRING_DEFS = 50
export const MAX_RECURRING_COUNT = 5
/** 회사 전체에서 하루에 정기 티켓으로 만들 수 있는 최대 건수. */
export const MAX_RECURRING_PER_DAY = 20

export const WEEKDAY_CHARS = ['일', '월', '화', '수', '목', '금', '토'] as const
export type WeekdayChar = (typeof WEEKDAY_CHARS)[number]

/** `daily`, `weekdays`(월-금), `weekly:<요일 한 글자>` (예: `weekly:월`). */
export type RecurringCadence = 'daily' | 'weekdays' | `weekly:${WeekdayChar}`
export const RECURRING_STATUSES = ['active', 'paused'] as const
export type RecurringStatus = (typeof RECURRING_STATUSES)[number]

export interface RecurringDefinition {
  id: string
  /** T-037 프로젝트 id. */
  projectId: string
  /** `{date}`(YYYY-MM-DD)만 치환된다. 다른 `{...}`는 글자 그대로 남는다. */
  titleTemplate: string
  goalTemplate: string
  criteriaTemplates: string[]
  cadence: RecurringCadence
  /** 1~5. 한 번에 만드는 티켓 수. */
  count: number
  /** 직원 id. null이면 프로젝트의 담당 PM. */
  assignee: string | null
  status: RecurringStatus
}

export interface RecurringItem extends RecurringDefinition {
  /** 다음 생성 예정 시각(epoch ms). 지금 틱에서 만들 차례이면 현재 시각, 일시정지는 null. 실제 생성은 그 뒤 첫 스케줄러 틱이다. */
  nextRunAt: number | null
  /** 오늘 몫이 이미 만들어졌는지. */
  createdToday: boolean
}

export interface RecurringList {
  items: RecurringItem[]
  /** 읽지 못해 무시된 블록 수. */
  unreadable: number
  /** 상한(`MAX_RECURRING_DEFS`)을 넘어 처리에서 제외되는 정의 수. */
  overLimit: number
}

export interface RecurringIdRequest {
  id: string
}
export interface RecurringSetStatusRequest {
  id: string
  status: RecurringStatus
}
