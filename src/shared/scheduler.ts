/** 오토파일럿 스케줄러(T-015) 계약. 원본은 `company/schedule.md`이고 이 구조는 파생물이다. */

export const SCHEDULE_MIN_INTERVAL_MINUTES = 5
export const SCHEDULE_MAX_INTERVAL_MINUTES = 1440

export type SchedulerTickState = 'idle' | 'running'

export type SchedulerSkipReason =
  'disabled' | 'outside-hours' | 'policy-hours' | 'not-due' | 'no-company' | 'halted'

export interface SchedulerStatus {
  /** 스케줄 파일의 켜기/끄기. 파일이 없거나 잘못되면 false. */
  enabled: boolean
  intervalMinutes: number
  /** `HH:MM-HH:MM` (자정을 넘길 수 있다). */
  activeHours: string
  state: SchedulerTickState
  /** 마지막 틱 시작 시각(epoch ms). 없으면 null. */
  lastRunAt: number | null
  /** 다음 실행 예정(epoch ms). 꺼져 있거나 알 수 없으면 null. 활동 시간 밖이면 실제 실행은 더 늦어질 수 있다. */
  nextRunAt: number | null
  lastResult: 'ok' | 'failed' | null
  /** 스케줄 파일에서 기본값으로 대체된 항목 설명(한국어). */
  warnings: string[]
}

export type SchedulerRunNowResult =
  { started: true } | { started: false; reason: 'busy' | 'no-company' | 'halted' }
