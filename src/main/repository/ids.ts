/** 외부 입력 id의 허용 형식. 파일 경로는 id로 조합하지 않고 목록의 파일명으로만 만든다. */
export const TICKET_ID = /^T-\d{1,6}$/
export const DECISION_ID = /^D-\d{1,6}$/
export const EMPLOYEE_ID = /^[a-z0-9][a-z0-9-]{0,49}$/
export const REPORT_ID = /^[A-Za-z0-9][A-Za-z0-9-]{0,99}$/

export const MAX_MEMO_LENGTH = 2000
export const MAX_MARKDOWN_LENGTH = 200_000

/** `T-004-some-slug.md` 같은 파일명에서 앞 id를 뽑는다. */
export function leadingId(fileName: string, kind: 'T' | 'D'): string | null {
  const m = new RegExp(`^(${kind}-\\d{1,6})(?:[-.]|$)`).exec(fileName)
  return m ? m[1] : null
}
