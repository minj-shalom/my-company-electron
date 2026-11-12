import {
  DECISION_KINDS,
  DECISION_PROPOSERS,
  type Decision,
  type DecisionKind,
  type DecisionOption,
  type DecisionProposer,
  type DecisionStatus
} from '../../shared/decision'
import {
  asString,
  bulletValue,
  firstHeading,
  metaValue,
  section,
  sectionWhere,
  splitFrontmatter
} from './markdown'
import { escapeMemoLine, unescapeMemoLine } from './decision-memo'
import { DECISION_ID, leadingId } from './ids'

export const DECISION_DIRS: Record<DecisionStatus, string> = {
  pending: 'company/decisions/pending',
  done: 'company/decisions/done'
}

// `1. **A. 라벨** — 설명` (구분자는 em dash, en dash, 하이픈, 콜론 허용; 설명은 선택)
const OPTION_LINE = /^\s*(?:\d+\.|[-*])\s+\*\*([A-Za-z0-9]+)[.)]\s*(.+?)\*\*\s*(?:[—–:-]\s*(.*))?$/

export function parseOptions(sectionText: string): DecisionOption[] {
  const options: DecisionOption[] = []
  for (const line of sectionText.split(/\r?\n/)) {
    const m = OPTION_LINE.exec(line)
    if (m) options.push({ key: m[1], label: m[2].trim(), description: (m[3] ?? '').trim() })
  }
  return options
}

/** "A (필요해지면 C)" 같은 자유 서술에서 선택지 key를 하나 고른다. 목록에 없으면 null. */
function pickKey(raw: string | null, options: DecisionOption[]): string | null {
  if (!raw) return null
  const m = /^[`*\s]*([A-Za-z0-9]+)(?![A-Za-z0-9])/.exec(raw)
  if (!m) return null
  const key = options.find((o) => o.key.toLowerCase() === m[1].toLowerCase())?.key
  return key ?? null
}

/** 허용 목록에 있는 값만 돌려준다. 알 수 없는 유형은 일반 결정으로 폴백한다 (목록을 깨지 않는다). */
function parseKind(raw: string | null): DecisionKind {
  const v = raw?.replace(/[`*]/g, '').trim().toLowerCase()
  return DECISION_KINDS.find((k) => k === v) ?? 'decision'
}

function parseProposer(raw: string | null): DecisionProposer | null {
  const v = raw?.replace(/[`*]/g, '').trim().toLowerCase()
  return DECISION_PROPOSERS.find((p) => p === v) ?? null
}

export function parseDecision(fileName: string, text: string, status: DecisionStatus): Decision {
  const id = leadingId(fileName, 'D')
  if (!id || !DECISION_ID.test(id)) throw new Error('파일명이 D-번호로 시작해야 합니다.')
  const { data, body } = splitFrontmatter(text)
  const title = asString(data.title) ?? firstHeading(body)?.replace(/^D-\d+\s*[:：]\s*/, '') ?? null
  if (!title) throw new Error('제목(# D-번호: 제목)을 찾을 수 없습니다.')

  // 메타 줄은 첫 `##` 앞에만 있다. 본문(질문, 결정 메모 등)의 비슷한 줄이 유형을 바꾸지 못하게 한다.
  const head = body.split(/\r?\n##[ \t]/, 1)[0]
  const related = metaValue(head, '관련 티켓')
  const ticketId = related ? (/T-\d{1,6}/.exec(related)?.[0] ?? null) : null
  const question = section(body, '질문') ?? ''
  const options = parseOptions(section(body, '선택지') ?? '')
  const recommended = pickKey(bulletValue(section(body, '추천안') ?? '', '추천'), options)

  const decided = sectionWhere(body, isDecisionTitle)
  const chosen = status === 'done' ? pickKey(bulletValue(decided ?? '', '선택'), options) : null
  const memo = decided ? memoOf(decided) : ''
  const kind = parseKind(metaValue(head, '유형'))
  const proposedBy = parseProposer(metaValue(head, '제안자'))
  return {
    id,
    title,
    status,
    ticketId,
    question,
    options,
    recommended,
    chosen,
    memo,
    kind,
    proposedBy
  }
}

/** `결정` 또는 `결정 (사람이 작성)`만. `결정 근거`처럼 접두어만 같은 제목은 다른 섹션이다. */
const DECISION_TITLE = /^결정(?:[ \t]*[(（].*)?$/
const isDecisionTitle = (title: string): boolean => DECISION_TITLE.test(title)

const CHOICE_LINE = /^[ \t]*[-*][ \t]+선택[ \t]*[:：]/
const MEMO_LINE = /^[ \t]*[-*][ \t]+메모[ \t]*[:：]/
const CONTINUATION = /^[ \t]{2,}\S/

/** `- 메모:` 줄과 그 아래 들여쓴 이어지는 줄. 쓸 때 붙인 이스케이프는 푼다. */
function memoOf(decided: string): string {
  const lines = decided.split(/\r?\n/)
  const i = lines.findIndex((l) => MEMO_LINE.test(l))
  if (i < 0) return ''
  const first = lines[i].replace(/^[ \t]*[-*][ \t]+메모[ \t]*[:：][ \t]*/, '')
  const rest: string[] = []
  for (const l of lines.slice(i + 1)) {
    if (CONTINUATION.test(l)) rest.push(unescapeMemoLine(l.trim()))
    else break
  }
  return [first, ...rest].join('\n').trim()
}

/**
 * 결정 섹션(`## 결정` 정확 일치)의 `- 선택:`, `- 메모:` 줄만 교체하고 상태 줄을 done으로 바꾼다.
 * 섹션의 나머지 줄과 파일의 개행(CRLF/LF)은 보존한다. 섹션이 없으면 끝에 새로 만든다.
 * `memo`는 `normalizeMemo`를 거친 값이어야 한다 (개행은 `\n`뿐, 제어문자 없음).
 * 이어지는 메모 줄은 들여쓰고 줄머리 구조 문자를 이스케이프해, 읽을 때 제목/펜스/목록/메타 줄로 해석되지 않게 한다.
 */
export function withDecisionResolved(text: string, choice: string, memo: string): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const memoLines = memo.trim().split('\n')
  const block = [`- 선택: ${choice}`, `- 메모: ${memoLines[0] ?? ''}`.trimEnd()]
  for (const l of memoLines.slice(1)) block.push(`  ${escapeMemoLine(l.trim())}`)

  const lines = text.split(/\r?\n/)
  // 상태 줄은 첫 `##` 앞의 메타 영역에서만 바꾼다.
  for (const [i, l] of lines.entries()) {
    if (/^##[ \t]/.test(l)) break
    if (/^[ \t]*[-*][ \t]+\*\*상태:\*\*/.test(l)) {
      lines[i] = l.replace(/(\*\*상태:\*\*)[ \t]*.*$/, '$1 done')
      break
    }
  }

  let start = -1
  let end = lines.length
  let fence = false
  for (let i = 0; i < lines.length; i++) {
    if (/^[ \t]*(```|~~~)/.test(lines[i])) fence = !fence
    if (fence) continue
    if (start < 0) {
      const m = /^##[ \t]+(\S.*)$/.exec(lines[i].trimEnd())
      if (m && isDecisionTitle(m[1])) start = i
    } else if (/^##[ \t]/.test(lines[i])) {
      end = i
      break
    }
  }
  if (start < 0) {
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop()
    lines.push('', '## 결정 (사람이 작성)', ...block, '')
    return lines.join(eol)
  }

  const body = lines.slice(start + 1, end)
  const choiceAt = body.findIndex((l) => CHOICE_LINE.test(l))
  const memoAt = body.findIndex((l) => MEMO_LINE.test(l))
  let memoEnd = memoAt + 1
  while (memoAt >= 0 && memoEnd < body.length && CONTINUATION.test(body[memoEnd])) memoEnd++

  const out: string[] = []
  let wroteChoice = false
  let wroteMemo = false
  const emitMemo = (): void => {
    out.push(...block.slice(1))
    wroteMemo = true
  }
  for (let i = 0; i < body.length; i++) {
    if (i === choiceAt) {
      out.push(block[0])
      wroteChoice = true
      if (memoAt < 0) emitMemo()
    } else if (i === memoAt) {
      emitMemo()
      i = memoEnd - 1
    } else {
      out.push(body[i])
    }
  }
  // 줄이 없던 카드: 섹션 맨 앞에 넣는다.
  if (!wroteChoice) out.unshift(block[0], ...(wroteMemo ? [] : block.slice(1)))
  else if (!wroteMemo) emitMemo()
  return [...lines.slice(0, start + 1), ...out, ...lines.slice(end)].join(eol)
}
