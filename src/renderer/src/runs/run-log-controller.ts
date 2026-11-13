/** 취소 흐름과 구독 수명주기의 결정 로직. React 밖에서 단위 테스트한다. */

import { runExclusive } from '../lib/refresh'
import { createBatcher, isActive, type RunStatus } from './run-log-model'

export const CANCEL_FAILED_TEXT = '취소하지 못했어요. 잠시 뒤 다시 시도해 주세요.'
export const CANCEL_GONE_TEXT = '이미 끝났거나 찾을 수 없는 실행이에요.'

export function canCancel(status: RunStatus, cancelling: boolean): boolean {
  return isActive(status) && !cancelling
}

export type CancelOutcome =
  | { kind: 'skipped' } // 이미 취소 요청 중
  | { kind: 'cancelled'; note: null }
  | { kind: 'gone'; note: string }
  | { kind: 'failed'; note: string }

/** 취소 요청 한 번. 잠금으로 이중 호출을 막고, 예외와 false를 고정 문구로 바꾼다. */
export async function requestCancel(
  lock: { current: boolean },
  cancel: (runId: string) => Promise<boolean>,
  runId: string,
  onBusy: (busy: boolean) => void
): Promise<CancelOutcome> {
  const r = await runExclusive(lock, async () => {
    onBusy(true)
    try {
      return await cancel(runId)
    } catch {
      return null
    } finally {
      onBusy(false)
    }
  })
  if (!r.ran) return { kind: 'skipped' }
  if (r.value === null) return { kind: 'failed', note: CANCEL_FAILED_TEXT }
  if (!r.value) return { kind: 'gone', note: CANCEL_GONE_TEXT }
  return { kind: 'cancelled', note: null }
}

export interface Subscription {
  /** 구독 실패 여부 (동기 호출 결과). */
  failed: boolean
  dispose: () => void
}

/** 구독 시작: 이벤트를 프레임 단위로 모아 onBatch로 넘긴다. dispose 뒤에는 어떤 콜백도 부르지 않는다. */
export function startSubscription(
  subscribe: (listener: (event: unknown) => void) => () => void,
  onBatch: (batch: unknown[]) => void,
  schedule: (cb: () => void) => number,
  cancelFrame: (id: number) => void
): Subscription {
  let active = true
  const batcher = createBatcher<unknown>(
    (batch) => {
      if (active) onBatch(batch)
    },
    schedule,
    cancelFrame
  )
  let off: (() => void) | null = null
  let failed = false
  try {
    off = subscribe((event) => {
      if (active) batcher.push(event)
    })
  } catch {
    failed = true
  }
  return {
    failed,
    dispose: () => {
      active = false
      batcher.dispose()
      off?.()
      off = null
    }
  }
}
