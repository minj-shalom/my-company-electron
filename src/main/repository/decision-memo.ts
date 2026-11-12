/** 줄바꿈으로 취급해 `\n`으로 통일할 문자: CRLF, CR, LS, PS, NEL, VT, FF. */
const LINE_BREAKS = /\r\n|[\r\n\u2028\u2029\u0085\v\f]/g
/** 개행/탭을 뺀 제어문자 (NUL 포함). 저장하지 않고 거부한다. */
// 제어문자를 찾는 것이 목적이라 의도적으로 제어문자 범위를 쓴다.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000e-\u001f\u007f]/

/** 메모를 줄바꿈 통일된 문자열로 만든다. 허용하지 않는 제어문자가 있으면 null. */
export function normalizeMemo(memo: string): string | null {
  const unified = memo.replace(LINE_BREAKS, '\n')
  return CONTROL_CHARS.test(unified) ? null : unified
}

/** 줄머리에 오면 마크다운 구조(제목, 펜스, 목록, 인용, 표)로 읽힐 수 있는 문자. 백슬래시는 이스케이프 표지라 함께 둔다. */
const STRUCTURAL_START = /^[#`~\-*+>|\\]/

/**
 * 이어지는 메모 줄이 구조로 읽히지 않도록 줄머리에 `\`를 붙인다. 빈 줄은 `\` 하나로 표시한다 (들여쓰기 목록이 끊기지 않게).
 * 한계: 줄머리 들여쓰기는 저장 시 `trim`되어 왕복에서 사라진다 (메모는 줄 내용만 보존한다).
 * `=`(setext 제목)나 `<!--`는 이스케이프하지 않는다: 들여쓴 이어지는 줄이라 이 앱의 파서에서는 구조로 읽히지 않는다. */
export function escapeMemoLine(line: string): string {
  if (line === '') return '\\'
  return STRUCTURAL_START.test(line) ? `\\${line}` : line
}

export function unescapeMemoLine(line: string): string {
  if (line === '\\') return ''
  return /^\\[#`~\-*+>|\\]/.test(line) ? line.slice(1) : line
}
