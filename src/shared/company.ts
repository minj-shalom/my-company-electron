/** 회사 폴더 생성 요청/응답 타입 (main/preload/renderer 공용). */

export type CompanyErrorCode =
  | 'invalid-request' // 입력 타입/형태 오류
  | 'invalid-name' // 이름 규칙 위반
  | 'invalid-path' // 경로 규칙 위반 (상대 경로, 경로 탈출, 디렉터리 아님)
  | 'already-exists' // 같은 이름의 항목이 이미 있음 (덮어쓰지 않는다)
  | 'path-not-allowed' // 폴더 선택 다이얼로그가 돌려준 경로가 아님 (D-005 B)
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

/**
 * 선택 다이얼로그의 용도. 'create-location'은 새 회사를 만들 상위 폴더, 'open'은 기존 회사 폴더.
 * main은 용도별로 선택된 경로만 기억해 `company:create`/`company:open`에서 허용한다 (D-005 B).
 */
export type CompanyFolderPurpose = 'create-location' | 'open'
export const COMPANY_FOLDER_PURPOSES: readonly CompanyFolderPurpose[] = ['create-location', 'open']

export type CompanyOpenErrorCode =
  | 'invalid-request' // 입력 타입/형태 오류
  | 'invalid-path' // 경로 규칙 위반 (상대 경로, `..`, 폴더 아님)
  | 'path-not-allowed' // 선택 다이얼로그(또는 방금 만든 회사)에서 온 경로가 아님
  | 'not-found' // 폴더가 없음
  | 'not-company' // 회사 폴더 표식(`CLAUDE.md`, `company/org.md`)이 없음
  | 'already-open' // 다른 회사가 이미 열려 있음 (회사 전환은 지원하지 않는다)
  | 'open-failed' // 그 외 오류

export interface CompanyOpenRequest {
  /** 선택 다이얼로그(`open` 용도)가 돌려준 경로 또는 `company:create`가 돌려준 `companyDir`. */
  path: string
}

export type CompanyOpenResult =
  { ok: true; company: CompanyInfo } | { ok: false; code: CompanyOpenErrorCode; message: string }

/**
 * 시작 시점의 회사 상태 (`company:current`).
 * - none: 아직 회사를 연 적 없음 (시작 화면 표시)
 * - open: 열려 있음
 * - missing: 마지막 회사 폴더를 찾을 수 없음. 기억한 경로는 지우지 않는다. name은 폴더 이름만이다.
 * - invalid: 폴더는 있으나 회사 표식이 사라짐
 */
export type CompanyState =
  | { status: 'none' }
  | { status: 'open'; company: CompanyInfo }
  | { status: 'missing'; name: string }
  | { status: 'invalid'; name: string; message: string }

/** 현재 열린 회사의 요약. 경로는 표시용이며 renderer가 파일 접근에 쓰지 않는다. */
export interface CompanyInfo {
  name: string
  dir: string
  /** company/mission.md 본문. 없으면 빈 문자열. */
  mission: string
}
