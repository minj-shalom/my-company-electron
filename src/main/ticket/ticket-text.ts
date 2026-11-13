import { FORGED_LINE_BREAK } from '../repository/markdown'

export interface TicketTextFields {
  title: string
  goal: string
  criteria: string[]
  /** null이면 "없음"으로 쓴다 (담당 없음은 정상 상태). */
  assignee: string | null
  /** null이면 줄을 쓰지 않는다. */
  department: string | null
  /** null이면 줄을 쓰지 않는다 (회사 공통). */
  projectId: string | null
  /** 정기 티켓(T-049)의 `<정의 id>/<YYYY-MM-DD>`. 있으면 `- **반복:**` 줄을 쓴다 (같은 날 중복 생성 방지용 표식). */
  repeat?: string | null
}

const MAX_SLUG = 50

/** 제목에서 파일명용 슬러그를 만든다. 영문 소문자·숫자·`-`만 남기고, 변환 결과가 비면 `ticket`. */
export function slugify(title: string): string {
  const s = title
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG)
    .replace(/-+$/g, '')
  return s === '' ? 'ticket' : s
}

export function ticketFileName(num: number, title: string): string {
  return `T-${String(num).padStart(3, '0')}-${slugify(title)}.md`
}

const assigneeLine = (a: string | null): string => `- **담당:** ${a ?? '없음'}`

/** `templates/ticket.md` 형식의 새 티켓 본문. */
export function renderTicket(id: string, f: TicketTextFields): string {
  const meta = [
    `- **상태:** backlog`,
    assigneeLine(f.assignee),
    ...(f.department !== null ? [`- **부서:** ${f.department}`] : []),
    ...(f.projectId !== null ? [`- **프로젝트:** ${f.projectId}`] : []),
    ...(f.repeat ? [`- **반복:** ${f.repeat}`] : []),
    `- **브랜치:** feature/${id}`,
    `- **의존:** 없음`
  ]
  return [
    `# ${id}: ${f.title}`,
    '',
    ...meta,
    '',
    '## 목표',
    f.goal,
    '',
    '## 완료 조건',
    ...f.criteria.map((c) => `- [ ] ${c}`),
    '',
    '## 메모',
    ''
  ].join('\n')
}

const FENCE_LINE = /^[ \t]*(```|~~~)/

/** 각 줄이 코드 펜스 안(펜스 줄 포함)인지. 편집은 펜스 밖 구조만 건드린다. */
function fenceMask(lines: string[]): boolean[] {
  let fence = false
  return lines.map((l) => {
    if (FENCE_LINE.test(l)) {
      fence = !fence
      return true
    }
    return fence
  })
}

function frontmatterEnd(lines: string[]): number {
  if (!/^\uFEFF?---[ \t]*$/.test(lines[0] ?? '')) return 0
  const end = lines.findIndex((l, i) => i > 0 && /^---[ \t]*$/.test(l))
  return end < 0 ? 0 : end + 1
}

const metaKeyRe = (key: string): RegExp => new RegExp(`^[-*][ \\t]+\\*\\*${key}:\\*\\*`)

/** 펜스 밖 `## 제목` 줄의 위치 (제목 문자열 일치). */
function findSection(lines: string[], title: string): number {
  const mask = fenceMask(lines)
  return lines.findIndex((l, i) => !mask[i] && l.trimEnd() === `## ${title}`)
}

function sectionEnd(lines: string[], start: number): number {
  const mask = fenceMask(lines)
  for (let i = start + 1; i < lines.length; i++) if (!mask[i] && /^##[ \t]/.test(lines[i])) return i
  return lines.length
}

function replaceSection(lines: string[], title: string, content: string[]): void {
  const start = findSection(lines, title)
  const block = [`## ${title}`, ...content, '']
  if (start < 0) {
    // 섹션이 없으면 메모 앞(없으면 끝)에 넣는다.
    const memo = findSection(lines, '메모')
    const at = memo < 0 ? lines.length : memo
    lines.splice(at, 0, ...block)
    return
  }
  lines.splice(start, sectionEnd(lines, start) - start, ...block)
}

/**
 * 기존 backlog 티켓 본문에서 제목, 담당·부서·프로젝트 줄, `## 목표`, `## 완료 조건`만 바꾸고 나머지(의존, 메모 등)는 보존한다.
 * 첫 `# ` 제목이 없으면 null (편집할 수 없는 형식). 호출자는 결과를 다시 파싱해 의도한 값으로 읽히는지 확인한다.
 */
export function rewriteTicket(text: string, id: string, f: TicketTextFields): string | null {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/)
  // 단독 CR·LS·PS는 줄을 위조할 수 있으니 이런 줄이 섞인 파일은 편집하지 않는다.
  if (lines.some((l) => FORGED_LINE_BREAK.test(l))) return null
  const from = frontmatterEnd(lines)
  const mask = fenceMask(lines)
  const heading = lines.findIndex((l, i) => i >= from && !mask[i] && /^#[ \t]/.test(l))
  if (heading < 0) return null
  lines[heading] = `# ${id}: ${f.title}`

  const metaEnd = (): number => {
    const m = fenceMask(lines)
    for (let i = heading + 1; i < lines.length; i++)
      if (!m[i] && /^##[ \t]/.test(lines[i])) return i
    return lines.length
  }
  const find = (key: string): number => {
    const m = fenceMask(lines)
    const re = metaKeyRe(key)
    const end = metaEnd()
    for (let i = heading + 1; i < end; i++) if (!m[i] && re.test(lines[i])) return i
    return -1
  }
  let anchor = find('상태')
  const entries: Array<[string, string | null]> = [
    ['담당', assigneeLine(f.assignee)],
    ['부서', f.department !== null ? `- **부서:** ${f.department}` : null],
    ['프로젝트', f.projectId !== null ? `- **프로젝트:** ${f.projectId}` : null]
  ]
  for (const [key, line] of entries) {
    const at = find(key)
    if (at >= 0) {
      if (line === null) lines.splice(at, 1)
      else {
        lines[at] = line
        anchor = at
      }
    } else if (line !== null) {
      const insertAt = anchor >= 0 ? anchor + 1 : heading + (lines[heading + 1] === '' ? 2 : 1)
      lines.splice(insertAt, 0, line)
      anchor = insertAt
    }
  }
  replaceSection(lines, '목표', f.goal.split('\n'))
  replaceSection(
    lines,
    '완료 조건',
    f.criteria.map((c) => `- [ ] ${c}`)
  )
  return lines.join(eol)
}
