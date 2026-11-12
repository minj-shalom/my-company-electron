/** 회사 폴더 생성 요청/응답 타입 (main/preload/renderer 공용). */

export type CompanyErrorCode =
  | 'invalid-request' // 입력 타입/형태 오류
  | 'invalid-name' // 이름 규칙 위반
  | 'invalid-path' // 경로 규칙 위반 (상대 경로, 경로 탈출, 디렉터리 아님)
  | 'already-exists' // 같은 이름의 항목이 이미 있음 (덮어쓰지 않는다)
  | 'create-failed' // 그 외 파일 시스템 오류

export interface CompanyCreateRequest {
  /** 회사 이름. 그대로 폴더 이름이 된다. */
  name: string
  /** 회사 폴더를 만들 상위 디렉터리의 절대 경로. */
  path: string
}

export type CompanyCreateResult =
  { ok: true; companyDir: string } | { ok: false; code: CompanyErrorCode; message: string }

/** 폴더 선택 결과. 사용자가 취소하면 null. */
export type CompanySelectFolderResult = string | null
