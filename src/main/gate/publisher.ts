/**
 * 발행 어댑터 계약(주입 지점). 실제 어댑터와 자격 증명 처리는 T-054가 만든다.
 * 게이트는 이 인터페이스만 호출하고, 자격 증명은 어댑터 구현 안에서만 쓰이며 어떤 반환값에도 담기지 않는다.
 */
export interface PublishRequest {
  projectId: string
  adapterId: string
  /** 산출물 폴더 기준 상대 경로. */
  draftPath: string
  /** 초안 내용의 SHA-256. 승인·발행한 내용이 같은지 확인하는 용도. */
  draftHash: string
  /** 같은 키로 두 번 호출하지 않는다 (게이트가 보장). 어댑터가 서버 측 멱등 키로 쓸 수 있다. */
  idempotencyKey: string
}

/** 실패 사유는 닫힌 목록이다. 원문 오류 메시지(URL, 토큰이 섞일 수 있음)를 돌려주지 않는다. */
export type PublishOutcome =
  { ok: true } | { ok: false; code: 'rejected' | 'network' | 'auth' | 'unknown' }

export interface Publisher {
  readonly id: string
  publish(req: PublishRequest, signal: AbortSignal): Promise<PublishOutcome>
}

/** 테스트와 T-054 전의 연결 확인용 가짜 어댑터. 호출을 기록하고 정해 둔 결과를 돌려준다. */
export function createFakePublisher(
  id = 'fake',
  outcome: PublishOutcome = { ok: true }
): Publisher & { requests: PublishRequest[] } {
  const requests: PublishRequest[] = []
  return {
    id,
    requests,
    publish: async (req) => {
      requests.push(req)
      return outcome
    }
  }
}
