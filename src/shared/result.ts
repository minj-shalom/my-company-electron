/** 도메인 API 공용 결과 타입. 예외 대신 코드로 실패를 돌려준다. */

export type DomainErrorCode =
  | 'invalid-request' // 입력 검증 실패
  | 'no-company' // 열린 회사가 없음
  | 'not-found' // 대상 id 없음
  | 'conflict' // 이미 처리된 항목 등 상태 충돌
  | 'not-implemented' // 이 환경(main)이 아직 지원하지 않음
  | 'internal' // 그 외 오류

export type ApiResult<T> =
  { ok: true; value: T } | { ok: false; code: DomainErrorCode; message: string }
