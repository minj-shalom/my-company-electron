import { MAX_PROPOSAL_ACTIONS, type ProposalAction } from '../../shared/proposal'
import { PROJECT_ID } from '../../shared/project'
import { EMPLOYEE_ID } from '../repository/ids'

/** 카드 본문 `proposal` 블록의 파서와 생성기. 블록은 에이전트가 쓴 신뢰할 수 없는 텍스트이므로 엄격한 allowlist만 받는다. */

export const MAX_BLOCK_CHARS = 12_000
const MAX_LINE = 4_000
const MAX_TEXT = 300
const MAX_DESCRIPTION = 1_000
const MAX_VALUES_JSON = 3_000
const MAX_TOOLS = 30
const HASH = /^[0-9a-f]{64}$/
const TEMPLATE_ID = /^[a-z0-9][a-z0-9-]{0,49}$/
const TOOL = /^[A-Za-z][A-Za-z0-9_:*().\-/ ]{0,59}$/
// 제어문자를 찾는 것이 목적이다.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f\u0085\u2028\u2029]/
/** CEO·COO 행은 앱이 바꾸지 않는다. 직급 문자열 변형(`Coo`, ` COO`)도 같은 값으로 본다. */
const PROTECTED = new Set(['ceo', 'coo'])
const protectedWord = (v: string): boolean => PROTECTED.has(v.trim().toLowerCase())

export type BlockResult =
  { ok: true; actions: ProposalAction[] } | { ok: false; reason: BlockFailure }
export type BlockFailure =
  | 'too-large'
  | 'empty'
  | 'too-many'
  | 'bad-line'
  | 'unknown-action'
  | 'unknown-key'
  | 'duplicate-key'
  | 'missing-key'
  | 'bad-value'
  | 'duplicate-action'
  | 'protected'

const fail = (reason: BlockFailure): BlockResult => ({ ok: false, reason })

type Raw = Map<string, string>

const KEYS: Record<ProposalAction['action'], { required: string[]; optional: string[] }> = {
  assign: { required: ['project', 'employee'], optional: [] },
  unassign: { required: ['project', 'employee'], optional: [] },
  hire: {
    required: ['template', 'id', 'department', 'reports-to'],
    optional: ['title', 'role']
  },
  update: {
    required: ['id'],
    optional: ['description', 'model', 'tools', 'base', 'after']
  },
  move: { required: ['id'], optional: ['department', 'reports-to', 'title', 'role'] },
  retire: { required: ['id'], optional: [] },
  'policy-change': { required: ['project', 'revision', 'values'], optional: [] }
}

const isAction = (v: string): v is ProposalAction['action'] => Object.hasOwn(KEYS, v)

function text(v: string | undefined, max = MAX_TEXT): string | null {
  if (v === undefined || v.length === 0 || v.length > max || v !== v.trim()) return null
  // 표 셀·코드 펜스 구분 문자는 직급·부서·역할에 쓰지 않는다.
  return CONTROL.test(v) || /[|`]/.test(v) ? null : v
}

function build(action: ProposalAction['action'], raw: Raw): ProposalAction | BlockFailure {
  const str = (k: string, max?: number): string | null => text(raw.get(k), max)
  const id = (k: string): string | null => {
    const v = raw.get(k)
    return v !== undefined && EMPLOYEE_ID.test(v) ? v : null
  }
  const project = (): string | null => {
    const v = raw.get('project')
    return v !== undefined && PROJECT_ID.test(v) ? v : null
  }
  switch (action) {
    case 'assign':
    case 'unassign': {
      const p = project()
      const e = id('employee')
      if (p === null || e === null) return 'bad-value'
      return PROTECTED.has(e) ? 'protected' : { action, project: p, employee: e }
    }
    case 'retire': {
      const e = id('id')
      if (e === null) return 'bad-value'
      return PROTECTED.has(e) ? 'protected' : { action, id: e }
    }
    case 'hire': {
      const t = raw.get('template')
      const e = id('id')
      const dep = str('department')
      const rep = str('reports-to')
      const title = raw.has('title') ? str('title') : undefined
      const role = raw.has('role') ? str('role') : undefined
      if (t === undefined || !TEMPLATE_ID.test(t) || e === null || dep === null || rep === null)
        return 'bad-value'
      if (title === null || role === null) return 'bad-value'
      if (PROTECTED.has(e) || protectedWord(dep) || (title !== undefined && protectedWord(title)))
        return 'protected'
      return { action, template: t, id: e, department: dep, reportsTo: rep, title, role }
    }
    case 'move': {
      const e = id('id')
      if (e === null) return 'bad-value'
      const out: Extract<ProposalAction, { action: 'move' }> = { action, id: e }
      for (const [k, f] of [
        ['department', 'department'],
        ['reports-to', 'reportsTo'],
        ['title', 'title'],
        ['role', 'role']
      ] as const) {
        if (!raw.has(k)) continue
        const v = str(k)
        if (v === null) return 'bad-value'
        out[f] = v
      }
      if (PROTECTED.has(e) || (out.title !== undefined && protectedWord(out.title)))
        return 'protected'
      if (
        out.department === undefined &&
        out.reportsTo === undefined &&
        out.title === undefined &&
        out.role === undefined
      )
        return 'missing-key'
      return out
    }
    case 'update': {
      const e = id('id')
      if (e === null) return 'bad-value'
      if (PROTECTED.has(e)) return 'protected'
      const out: Extract<ProposalAction, { action: 'update' }> = { action, id: e }
      if (raw.has('description')) {
        const d = str('description', MAX_DESCRIPTION)
        if (d === null) return 'bad-value'
        out.description = d
      }
      if (raw.has('model')) {
        const m = str('model', 20)
        if (m === null) return 'bad-value'
        out.model = m
      }
      if (raw.has('tools')) {
        const list = (raw.get('tools') ?? '').split(',').map((x) => x.trim())
        if (list.length === 0 || list.length > MAX_TOOLS || list.some((x) => !TOOL.test(x)))
          return 'bad-value'
        out.tools = list
      }
      for (const k of ['base', 'after'] as const) {
        if (!raw.has(k)) continue
        const v = raw.get(k) ?? ''
        if (!HASH.test(v)) return 'bad-value'
        out[k] = v
      }
      const hasFields =
        out.description !== undefined || out.model !== undefined || out.tools !== undefined
      // 필드가 없으면 hr 재편집 경로의 승인 해시 전용이다: 변경 전·후 해시가 모두 있어야 한다.
      if (!hasFields && (out.base === undefined || out.after === undefined)) return 'missing-key'
      return out
    }
    case 'policy-change': {
      const p = project()
      const rev = raw.get('revision')
      const v = raw.get('values')
      if (
        p === null ||
        rev === undefined ||
        rev.length === 0 ||
        rev.length > 64 ||
        CONTROL.test(rev)
      )
        return 'bad-value'
      if (v === undefined || v.length > MAX_VALUES_JSON) return 'bad-value'
      let values: unknown
      try {
        values = JSON.parse(v)
      } catch {
        return 'bad-value'
      }
      if (typeof values !== 'object' || values === null || Array.isArray(values)) return 'bad-value'
      return { action, project: p, revision: rev, values }
    }
  }
}

const LINE = /^-[ \t]+([a-z][a-z-]{0,20})[ \t]*:[ \t]*(.*)$/

/** 대상 중복 판정용 키. assign과 unassign이 같은 쌍을 가리켜도 모순이므로 같은 키를 쓴다. */
function targetKey(a: ProposalAction): string {
  switch (a.action) {
    case 'assign':
    case 'unassign':
      return `member:${a.project}:${a.employee}`
    case 'policy-change':
      return `policy:${a.project}`
    case 'hire':
      return `agent:${a.id}`
    default:
      return `agent:${a.id}`
  }
}

/** `proposal` 펜스 안쪽 텍스트를 액션 목록으로 바꾼다. 하나라도 어긋나면 전체를 거부한다. */
export function parseProposalBlock(block: string): BlockResult {
  if (block.length > MAX_BLOCK_CHARS) return fail('too-large')
  const groups: Array<{ action: ProposalAction['action']; raw: Raw }> = []
  let cur: { action: ProposalAction['action']; raw: Raw } | null = null
  for (const line of block.split(/\r?\n/)) {
    if (line.trim() === '') continue
    if (line.length > MAX_LINE) return fail('too-large')
    const m = LINE.exec(line)
    if (!m) return fail('bad-line')
    const key = m[1]
    const value = m[2].trim()
    if (key === 'action') {
      if (!isAction(value)) return fail('unknown-action')
      if (groups.length >= MAX_PROPOSAL_ACTIONS) return fail('too-many')
      cur = { action: value, raw: new Map() }
      groups.push(cur)
      continue
    }
    if (cur === null) return fail('bad-line')
    const spec = KEYS[cur.action]
    if (!spec.required.includes(key) && !spec.optional.includes(key)) return fail('unknown-key')
    if (cur.raw.has(key)) return fail('duplicate-key')
    cur.raw.set(key, value)
  }
  if (groups.length === 0) return fail('empty')
  const actions: ProposalAction[] = []
  const seen = new Set<string>()
  for (const g of groups) {
    if (!KEYS[g.action].required.every((k) => g.raw.has(k))) return fail('missing-key')
    const built = build(g.action, g.raw)
    if (typeof built === 'string') return fail(built)
    const key = targetKey(built)
    if (seen.has(key)) return fail('duplicate-action')
    seen.add(key)
    actions.push(built)
  }
  return { ok: true, actions }
}

/** 파싱된 액션을 블록 텍스트로 만든다 (COO가 카드를 쓰거나 앱이 카드를 만들 때). 파서 규칙과 같은 모양이다. */
export function renderProposalBlock(actions: readonly ProposalAction[]): string {
  const out: string[] = []
  for (const a of actions) {
    out.push(`- action: ${a.action}`)
    switch (a.action) {
      case 'assign':
      case 'unassign':
        out.push(`- project: ${a.project}`, `- employee: ${a.employee}`)
        break
      case 'hire':
        out.push(
          `- template: ${a.template}`,
          `- id: ${a.id}`,
          `- department: ${a.department}`,
          `- reports-to: ${a.reportsTo}`
        )
        if (a.title !== undefined) out.push(`- title: ${a.title}`)
        if (a.role !== undefined) out.push(`- role: ${a.role}`)
        break
      case 'update':
        out.push(`- id: ${a.id}`)
        if (a.description !== undefined) out.push(`- description: ${a.description}`)
        if (a.model !== undefined) out.push(`- model: ${a.model}`)
        if (a.tools !== undefined) out.push(`- tools: ${a.tools.join(', ')}`)
        if (a.base !== undefined) out.push(`- base: ${a.base}`)
        if (a.after !== undefined) out.push(`- after: ${a.after}`)
        break
      case 'move':
        out.push(`- id: ${a.id}`)
        if (a.department !== undefined) out.push(`- department: ${a.department}`)
        if (a.reportsTo !== undefined) out.push(`- reports-to: ${a.reportsTo}`)
        if (a.title !== undefined) out.push(`- title: ${a.title}`)
        if (a.role !== undefined) out.push(`- role: ${a.role}`)
        break
      case 'retire':
        out.push(`- id: ${a.id}`)
        break
      case 'policy-change':
        out.push(
          `- project: ${a.project}`,
          `- revision: ${a.revision}`,
          `- values: ${JSON.stringify(a.values)}`
        )
        break
    }
  }
  return out.join('\n')
}

const FENCE_OPEN = /^```proposal[ \t]*$/
const FENCE_CLOSE = /^```[ \t]*$/

/**
 * 마크다운 텍스트에서 `proposal` 펜스 안쪽을 모두 꺼낸다. 닫히지 않은 펜스는 버린다.
 * 카드 본문(질문 섹션)과 hr 최종 응답 양쪽에 쓴다.
 */
export function extractProposalBlocks(markdown: string): string[] {
  const blocks: string[] = []
  let open: string[] | null = null
  for (const line of markdown.split(/\r?\n/)) {
    if (open === null) {
      if (FENCE_OPEN.test(line)) open = []
    } else if (FENCE_CLOSE.test(line)) {
      blocks.push(open.join('\n'))
      open = null
    } else {
      open.push(line)
      if (open.length > 400) open = null // 과대 블록은 닫히지 않은 것으로 본다
    }
  }
  return blocks
}
