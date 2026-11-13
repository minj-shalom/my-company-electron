import { EMPLOYEE_ID } from '../repository/ids'
import { hasForbiddenChar } from '../../shared/project'

/**
 * `project.md` 블록의 `- 키: 값` 줄 파서. `PM:`(T-037), `직원:`(T-045), 감사·제안 편집(T-052)이 같은 규칙으로 줄을 읽도록 공용으로 둔다.
 * 문자열 연산만 쓴다 (값에 정규식을 쓰면 공백이 긴 줄에서 O(n²)가 될 수 있다).
 */

const MAX_KEY = 40
const MAX_LINE = 4000

export interface FieldLine {
  key: string
  value: string
}

/**
 * 0번 열의 `- 키: 값` 줄만 읽는다. 들여쓴 줄, 콜론이 없는 줄, 너무 긴 줄은 필드가 아니다 (null).
 * 줄 경계 위조에 쓰이는 문자(단독 `\r`, U+2028/2029, 제어 문자)가 낀 줄은 `forged`로 표시해 호출자가 그 블록을 신뢰하지 않게 한다.
 */
export function parseFieldLine(line: string): (FieldLine & { forged: boolean }) | null {
  if (line.length > MAX_LINE || !line.startsWith('- ')) return null
  const colon = line.indexOf(':')
  if (colon < 0) return null
  const key = line.slice(2, colon).trim()
  if (key.length === 0 || key.length > MAX_KEY) return null
  // 탭은 들여쓰기·정렬에 흔히 쓰이므로 위조 문자로 보지 않는다. 값 앞뒤 탭은 trim이 지운다.
  return {
    key,
    value: line.slice(colon + 1).trim(),
    forged: hasForbiddenChar(line.replaceAll('\t', ' '))
  }
}

export function formatFieldLine(key: string, value: string): string {
  return `- ${key}: ${value}`
}

/** `PM:` 값. 직원 id 한 개만 허용한다 (프로젝트당 PM 1명). 아니면 null. */
export function parsePmValue(value: string): string | null {
  return EMPLOYEE_ID.test(value) ? value : null
}

/** `직원:` 값(T-045). 쉼표로 구분한 직원 id 목록. 하나라도 형식이 틀리면 null. */
export function parseEmployeeListValue(value: string): string[] | null {
  if (value === '') return []
  const ids = value.split(',').map((v) => v.trim())
  return ids.every((id) => EMPLOYEE_ID.test(id)) ? ids : null
}
