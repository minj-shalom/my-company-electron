/** 회사 이름 규칙. main(scaffold)과 renderer가 같은 함수를 쓴다. 이름은 그대로 폴더 이름이 된다. */

export const MAX_COMPANY_NAME_LENGTH = 50
// Windows 파일명 금지 문자와 제어 문자. 두 OS 모두에서 같은 폴더가 만들어지도록 함께 막는다.
// eslint-disable-next-line no-control-regex
const FORBIDDEN_NAME_CHARS = /[<>:"/\\|?*\u0000-\u001f]/
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

/** 이름 규칙을 검사한다. 위반 시 이유를 돌려주고, 통과하면 null. */
export function validateCompanyName(name: unknown): string | null {
  if (typeof name !== 'string') return '이름은 문자열이어야 합니다.'
  if (name.length === 0 || name.length > MAX_COMPANY_NAME_LENGTH)
    return `이름은 1~${MAX_COMPANY_NAME_LENGTH}자여야 합니다.`
  if (name !== name.trim()) return '이름 앞뒤에 공백을 둘 수 없습니다.'
  if (name.startsWith('.')) return '이름은 .으로 시작할 수 없습니다.'
  if (name.endsWith('.')) return '이름은 .으로 끝날 수 없습니다.'
  if (FORBIDDEN_NAME_CHARS.test(name)) return '이름에 쓸 수 없는 문자가 있습니다.'
  if (WINDOWS_RESERVED.test(name)) return '시스템 예약 이름은 쓸 수 없습니다.'
  return null
}
