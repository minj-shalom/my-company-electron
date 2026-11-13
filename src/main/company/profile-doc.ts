import { createHash } from 'node:crypto'

/** `company/mission.md`를 편집 가능한 섹션으로 나누고 다시 합친다. 모르는 섹션과 순서는 그대로 둔다. */

export type ProfileField = 'vision' | 'mission' | 'principles'
export const SECTION_HEADINGS: Record<ProfileField, string> = {
  vision: '비전',
  mission: '미션',
  principles: '운영 원칙'
}
const FIELDS = Object.keys(SECTION_HEADINGS) as ProfileField[]

export const revisionOf = (text: string): string =>
  createHash('sha256').update(text).digest('hex').slice(0, 32)

interface Block {
  /** `## 제목` 줄의 제목. 첫 `##` 이전 머리말은 null. */
  heading: string | null
  /** 제목 줄을 포함한 원문 줄들. */
  lines: string[]
}

/** CommonMark식 펜스 추적: 같은 문자로, 여는 길이 이상이고 뒤에 공백만 있는 줄이 닫는다. */
function nextFence(open: string | null, line: string): string | null {
  if (open === null) {
    const m = /^ {0,3}(`{3,}|~{3,})/.exec(line)
    // 백틱 펜스의 info 문자열에는 백틱이 올 수 없다.
    return m && !(m[1][0] === '`' && line.slice(m[0].length).includes('`')) ? m[1] : null
  }
  const c = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line)
  return c && c[1][0] === open[0] && c[1].length >= open.length ? null : open
}

/** 본문이 열린 코드 펜스로 끝나면 true. 뒤따르는 섹션이 펜스 안으로 들어가 버린다. */
export function endsInsideFence(text: string): boolean {
  let open: string | null = null
  for (const line of text.split('\n')) open = nextFence(open, line)
  return open !== null
}

function split(text: string): Block[] {
  const blocks: Block[] = [{ heading: null, lines: [] }]
  let fence: string | null = null
  for (const line of text.split('\n')) {
    const wasOpen = fence !== null
    fence = nextFence(fence, line)
    const m = !wasOpen && fence === null ? /^##[ \t]+(.+?)[ \t]*$/.exec(line) : null
    if (m) blocks.push({ heading: m[1], lines: [line] })
    else blocks[blocks.length - 1].lines.push(line)
  }
  return blocks
}

const fieldOf = (heading: string | null): ProfileField | undefined =>
  FIELDS.find((f) => SECTION_HEADINGS[f] === heading)

const bodyOf = (b: Block): string => b.lines.slice(1).join('\n').trim()

const TITLE_FORMS: { re: RegExp; make: (n: string) => string }[] = [
  { re: /^#[ \t]+(.+?):[ \t]*미션[ \t]*$/, make: (n) => `# ${n}: 미션` },
  { re: /^#[ \t]+회사 미션[ \t]*\((.+)\)[ \t]*$/, make: (n) => `# 회사 미션 (${n})` }
]

function titleIndex(head: string[]): number {
  return head.findIndex((l) => /^#[ \t]+\S/.test(l))
}

export interface ParsedProfile {
  name: string
  vision: string
  mission: string
  principles: string
}

export function parseProfile(text: string): ParsedProfile {
  const blocks = split(text)
  const head = blocks[0].lines
  const ti = titleIndex(head)
  let name = ''
  if (ti >= 0) {
    const title = head[ti].trimEnd()
    const form = TITLE_FORMS.find((f) => f.re.test(title))
    name = form ? (form.re.exec(title) as RegExpExecArray)[1].trim() : title.replace(/^#\s+/, '')
  }
  const out: ParsedProfile = { name, vision: '', mission: '', principles: '' }
  for (const b of blocks) {
    const f = fieldOf(b.heading)
    // 같은 제목이 여러 번이면 첫 섹션을 편집 대상으로 본다.
    if (f && out[f] === '' && b === blocks.find((x) => fieldOf(x.heading) === f)) out[f] = bodyOf(b)
  }
  return out
}

/** 바뀐 필드만 본문을 교체한다. 없는 섹션은 끝에 덧붙이고, 바뀌지 않은 부분은 바이트 그대로 둔다. */
export function applyProfile(text: string, next: ParsedProfile): string {
  const cur = parseProfile(text)
  const blocks = split(text)
  const head = blocks[0].lines
  if (next.name !== cur.name) {
    const ti = titleIndex(head)
    if (ti >= 0) {
      const form = TITLE_FORMS.find((f) => f.re.test(head[ti].trimEnd()))
      head[ti] = form ? form.make(next.name) : `# ${next.name}: 미션`
    } else {
      head.unshift(`# ${next.name}: 미션`, '')
    }
  }
  for (const f of FIELDS) {
    if (next[f] === cur[f]) continue
    const block = blocks.find((b) => fieldOf(b.heading) === f)
    const body = next[f] === '' ? [''] : ['', ...next[f].split('\n'), '']
    if (block) {
      // 뒤따르는 섹션과 붙지 않도록 빈 줄을 하나 남긴다.
      block.lines = [block.lines[0], ...body]
    } else {
      const last = blocks[blocks.length - 1]
      while (last.lines.length > 0 && last.lines[last.lines.length - 1].trim() === '')
        last.lines.pop()
      last.lines.push('')
      blocks.push({ heading: SECTION_HEADINGS[f], lines: [`## ${SECTION_HEADINGS[f]}`, ...body] })
    }
  }
  const joined = blocks.map((b) => b.lines.join('\n')).join('\n')
  return joined.endsWith('\n') ? joined : `${joined}\n`
}
