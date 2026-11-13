/** 회사 정보(이름, 비전, 미션, 운영 원칙) 계약. 원본은 회사 폴더의 `company/mission.md`다. */

export const PROFILE_PATH = 'company/mission.md'
/** 비전, 미션, 운영 원칙 본문 합계 상한(UTF-8 바이트). */
export const MAX_PROFILE_BODY_BYTES = 64 * 1024

export interface CompanyProfile {
  /** 표시 이름. 회사 폴더 이름과 다를 수 있고 이 API로는 폴더 이름을 바꾸지 않는다. */
  name: string
  vision: string
  mission: string
  principles: string
  /** 읽은 시점 파일 내용의 해시. 저장 때 그대로 돌려보내 외부 변경을 감지한다. */
  revision: string
}

export interface CompanyProfileSaveRequest {
  name: string
  vision: string
  mission: string
  principles: string
  revision: string
}
