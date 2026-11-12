/** 보고서 타입. 원본은 `company/reports/*.md`. */

export interface Report {
  /** 파일명(확장자 제외). 예: T-004-window-api-contract-and-mock */
  id: string
  title: string
  /** 제목/파일명에서 읽은 관련 티켓 id. 없으면 null. */
  ticketId: string | null
  /** 마크다운. renderer는 sanitize 후 렌더링한다. */
  body: string
}
