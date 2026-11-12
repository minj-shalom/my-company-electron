import type { RunErrorCode, RunEvent } from '../../shared/run'

export type ProviderId = 'claude'

export type StartResult =
  { ok: true; runId: string } | { ok: false; code: RunErrorCode; message: string }

/**
 * 제공자 CLI 어댑터 공통 계약. 모든 제공자의 출력은 shared/run.ts의 RunEvent로 변환해 emit한다.
 * 인증은 각 CLI가 처리하며 어댑터는 토큰·로그인 정보를 읽거나 저장하지 않는다.
 */
export interface ProviderAdapter {
  readonly id: ProviderId
  /** 입력 검증 후 CLI를 실행한다. 이벤트는 emit으로 흘려보내고 마지막은 항상 exit 이벤트다. */
  start(req: unknown, emit: (event: RunEvent) => void): StartResult
  /** 진행 중인 실행을 취소한다. 알 수 없는 runId면 false. */
  cancel(runId: string): boolean
  cancelAll(): void
}
