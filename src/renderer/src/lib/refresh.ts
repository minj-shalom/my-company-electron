/** 결재함과 티켓 보드가 함께 쓰는 새로고침·잠금·unreadable 문구의 순수 로직. */

import type { UnreadableReason } from '../../../shared/decision'

/** main 이벤트가 생기기 전까지 쓰는 임시 폴링 간격. */
export const POLL_INTERVAL_MS = 30_000
/** 포커스가 연달아 오갈 때 요청이 몰리지 않게 하는 최소 간격. */
export const FOCUS_MIN_GAP_MS = 3_000

export function shouldRefetchOnFocus(lastFetchAt: number | null, now: number): boolean {
  return lastFetchAt === null || now - lastFetchAt >= FOCUS_MIN_GAP_MS
}

/**
 * 조회 응답의 세대 가드. 조회를 시작한 뒤 쓰기(처리·이동)가 끝나거나 강제 재조회가 시작되면 그 이전 응답은 낡은 것이므로 버린다
 * (낡은 응답이 방금 처리한 항목을 이전 상태로 되살리는 것을 막는다).
 */
export interface RefreshGuard {
  begin: () => number
  invalidate: () => void
  isCurrent: (token: number) => boolean
}

export function createRefreshGuard(): RefreshGuard {
  let gen = 0
  return {
    begin: () => gen,
    invalidate: () => {
      gen += 1
    },
    isCurrent: (token) => token === gen
  }
}

/** 연타 방지. state 반영 전에도 즉시 잠그도록 ref 객체로 잠금을 받는다. 이미 실행 중이면 fn을 호출하지 않는다. */
export async function runExclusive<T>(
  lock: { current: boolean },
  fn: () => Promise<T>
): Promise<{ ran: true; value: T } | { ran: false }> {
  if (lock.current) return { ran: false }
  lock.current = true
  try {
    return { ran: true, value: await fn() }
  } finally {
    lock.current = false
  }
}

/** 주어(카드가, 티켓이)만 다르고 사유 문구는 같다. */
export function unreadableTexts(subject: string): Record<UnreadableReason, string> {
  return {
    unreadable: '읽을 수 없는 파일이에요',
    duplicate: `같은 번호의 ${subject} 둘 이상 있어 숨겼어요`,
    'too-large': '파일이 너무 커서 읽지 않았어요'
  }
}

/** 허용 목록 밖 사유는 가장 일반적인 문구로 대신한다 (목록을 깨지 않는다). */
export function unreadableReasonTextFor(
  texts: Record<UnreadableReason, string>,
  reason: unknown
): string {
  return (
    (typeof reason === 'string' && Object.hasOwn(texts, reason)
      ? texts[reason as UnreadableReason]
      : undefined) ?? texts.unreadable
  )
}
