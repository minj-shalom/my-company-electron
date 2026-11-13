import type { VisitItem } from '../../shared/visit'

export interface DecisionNotifierDeps {
  isEnabled: () => Promise<boolean>
  isWindowActive: () => boolean
  /** 아직 알리지 않은 새 pending 카드를 꺼내며 알림 기록에 남긴다. */
  takeUnnotified: () => Promise<VisitItem[]>
  /** OS 알림을 띄운다. 제목과 본문은 이 모듈이 만든 고정 문구와 건수뿐이다. */
  show: (title: string, body: string) => void
}

/** 알림에는 카드 제목·본문·경로를 넣지 않고 건수만 담는다. */
export function createDecisionNotifier(deps: DecisionNotifierDeps): {
  check: () => Promise<number>
} {
  let running: Promise<number> | null = null
  const run = async (): Promise<number> => {
    // 창이 활성이거나 끄면 기록을 소비하지 않는다. 나중에 비활성이 되었을 때 알릴 수 있다.
    if (!(await deps.isEnabled()) || deps.isWindowActive()) return 0
    const fresh = await deps.takeUnnotified()
    if (fresh.length === 0) return 0
    deps.show('새 결재 요청', `결정이 필요한 카드가 ${fresh.length}건 도착했어요.`)
    return fresh.length
  }
  return {
    // 틱 종료와 주기 점검이 겹쳐도 한 번에 하나만 돈다.
    check: () => {
      running ??= run().finally(() => {
        running = null
      })
      return running
    }
  }
}
