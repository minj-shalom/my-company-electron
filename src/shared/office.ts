/**
 * 가상 사무실의 직원 상태 계약. 지금은 renderer 안의 공급자(개발 모드 mock)가 채우고,
 * 실행 이벤트(`RunEvent`)와 티켓/결재 상태가 연결되면 같은 인터페이스를 구현하는 실제 공급자로 교체한다.
 */

/** 아바타 상태: 대기, 작업 중, 승인(결재) 대기. */
export const AVATAR_STATUSES = ['idle', 'working', 'awaiting-approval'] as const
export type AvatarStatus = (typeof AVATAR_STATUSES)[number]

/** 직급(`OrgMember.title`) -> 상태. 목록에 없는 직원은 `idle`로 본다. */
export type OfficeStatusMap = Readonly<Record<string, AvatarStatus>>

export interface OfficeStatusSource {
  /**
   * 주어진 직원들의 상태 변화를 구독한다. 구독 직후 현재 상태를 한 번 보내고, 이후에는 값이 바뀔 때만 보낸다.
   * 반환된 함수로 해제한다 (타이머/구독을 남기지 않는다).
   */
  subscribe: (
    titles: readonly string[],
    onChange: (statuses: OfficeStatusMap) => void
  ) => () => void
}
