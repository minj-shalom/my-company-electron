/** 도메인 API 공용 결과 타입. 예외 대신 코드로 실패를 돌려준다. */

export type DomainErrorCode =
  | 'invalid-request' // 입력 검증 실패
  | 'no-company' // 열린 회사가 없음
  | 'not-found' // 대상 id 없음
  | 'conflict' // 이미 처리된 항목 등 상태 충돌
  | 'forbidden' // 보호 대상(COO, CEO 등)이라 허용되지 않음
  | 'approval-required' // 민감 변경인데 승인된 결정 카드 번호가 없거나 유효하지 않음
  | 'path-not-allowed' // 폴더 선택 다이얼로그가 돌려준 경로가 아님 (프로젝트 경로, D-005 B)
  | 'not-implemented' // 이 환경(main)이 아직 지원하지 않음
  | 'internal' // 그 외 오류

export type ApiResult<T> =
  { ok: true; value: T } | { ok: false; code: DomainErrorCode; message: string }
