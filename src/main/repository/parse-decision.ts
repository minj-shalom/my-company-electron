import type { Decision, DecisionOption, DecisionStatus } from '../../shared/decision'
import { asString, firstHeading, metaValue, section, splitFrontmatter } from './markdown'
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

function bullet(sectionText: string | null, label: string): string | null {
  if (!sectionText) return null
  const m = new RegExp(`^\\s*[-*]\\s+${label}\\s*[:：]\\s*(.*)$`, 'm').exec(sectionText)
  return m ? m[1].trim() : null
}

export function parseDecision(fileName: string, text: string, status: DecisionStatus): Decision {
  const id = leadingId(fileName, 'D')
  if (!id || !DECISION_ID.test(id)) throw new Error('파일명이 D-번호로 시작해야 합니다.')
  const { data, body } = splitFrontmatter(text)
  const title = asString(data.title) ?? firstHeading(body)?.replace(/^D-\d+\s*[:：]\s*/, '') ?? null
  if (!title) throw new Error('제목(# D-번호: 제목)을 찾을 수 없습니다.')

  const related = metaValue(body, '관련 티켓')
  const ticketId = related ? (/T-\d{1,6}/.exec(related)?.[0] ?? null) : null
  const question = section(body, '질문') ?? ''
  const options = parseOptions(section(body, '선택지') ?? '')
  const recommended = pickKey(bullet(section(body, '추천안'), '추천'), options)

  const decided = section(body, '결정')
  const chosen = status === 'done' ? pickKey(bullet(decided, '선택'), options) : null
  const memo = decided ? memoOf(decided) : ''
  return { id, title, status, ticketId, question, options, recommended, chosen, memo }
}

/** `- 메모:` 줄과 그 아래 들여쓴 이어지는 줄. */
function memoOf(decided: string): string {
  const lines = decided.split(/\r?\n/)
  const i = lines.findIndex((l) => /^\s*[-*]\s+메모\s*[:：]/.test(l))
  if (i < 0) return ''
  const first = lines[i].replace(/^\s*[-*]\s+메모\s*[:：]\s*/, '')
  const rest: string[] = []
  for (const l of lines.slice(i + 1)) {
    if (/^\s{2,}\S/.test(l)) rest.push(l.trim())
    else break
  }
  return [first, ...rest].join('\n').trim()
}

/**
 * 결정 섹션(`## 결정 ...`)의 선택/메모를 채우고 상태 줄을 done으로 바꾼다.
 * 섹션이 없으면 끝에 새로 만든다. 메모의 줄바꿈은 들여쓰기로 이어 붙여 목록 구조를 깨지 않는다.
 */
export function withDecisionResolved(text: string, choice: string, memo: string): string {
  const memoLines = memo.trim().split(/\r?\n/)
  const block = [`- 선택: ${choice}`, `- 메모: ${memoLines[0] ?? ''}`.trimEnd()]
  for (const l of memoLines.slice(1)) block.push(`  ${l.trim()}`.trimEnd())

  let out = text.replace(/^(\s*[-*]\s+\*\*상태:\*\*)[ \t]*.*$/m, '$1 done')
  const lines = out.split('\n')
  let start = -1
  let end = lines.length
  let fence = false
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) fence = !fence
    if (fence) continue
    if (start < 0) {
      if (/^##\s+결정/.test(lines[i])) start = i
    } else if (/^##\s+/.test(lines[i])) {
      end = i
      break
    }
  }
  if (start < 0) {
    out = `${out.replace(/\s*$/, '')}\n\n## 결정 (사람이 작성)\n${block.join('\n')}\n`
  } else {
    const tail = lines.slice(end)
    const next = [...lines.slice(0, start + 1), ...block, ...(tail.length ? ['', ...tail] : [''])]
    out = next.join('\n')
  }
  return out
}
