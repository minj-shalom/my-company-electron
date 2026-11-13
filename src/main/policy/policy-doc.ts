import { createHash } from 'node:crypto'
import {
  APPROVAL_MODES,
  hasRefPrefix,
  isProtectedBranch,
  prefixCoversProtected,
  LIMITED_ACTIONS,
  MAX_DAILY_LIMIT,
  MAX_DAILY_OUTPUT_GOAL,
  MAX_POLICY_MEMO,
  POLICY_ACTIONS,
  POLICY_FLOWS,
  PROTECTED_MERGE_MAX_DAILY,
  REVIEW_STAGES,
  type ApprovalMode,
  type EffectivePolicy,
  type LimitedAction,
  type PolicyActivation,
  type PolicyAction,
  type PolicyHistoryEntry,
  type PolicyValues,
  type PolicyWarning,
  type PolicyWarningCode
} from '../../shared/policy'
import {
  MAX_BRANCH,
  checkProjectName,
  hasForbiddenChar,
  type ProjectType
} from '../../shared/project'
import { formatFieldLine, parseFieldLine } from '../project/field-lines'
import { isValidBranch } from '../project/project-doc'

/**
 * `company/policies/<id>.md`의 순수 파서·검증·직렬화 (파일 접근 없음).
 * 알 수 없는 줄은 한 글자도 바꾸지 않고, 알려진 키 줄만 제자리에서 바꾼다. 정책 문서는 지침이고 실제 강제는 T-053 게이트가 한다.
 */

export const HISTORY_HEADING = '## 변경 이력'

const K = {
  flow: '흐름',
  push: '푸시',
  merge: '머지',
  publish: '발행',
  draft: '초안 승인',
  limits: '일일 상한',
  pushTargets: '자동 푸시 대상',
  mergeTargets: '자동 머지 대상',
  confirm: '확인 입력',
  activation: '자동 활성화',
  prefix: '브랜치 접두어',
  base: '기반 브랜치',
  usePr: 'PR 사용',
  review: '검수 단계',
  goal: '일일 산출 목표',
  outDir: '산출물 폴더',
  adapter: '발행 어댑터',
  hours: '활동 요일·시간',
  memo: '메모'
} as const
const ACTION_KEY: Record<PolicyAction, string> = {
  push: K.push,
  merge: K.merge,
  publish: K.publish,
  'draft-approve': K.draft
}
const ACTION_LABEL: Record<PolicyAction, string> = ACTION_KEY
const KNOWN_KEYS: ReadonlySet<string> = new Set(Object.values(K))
/** 표시·기록 순서. 새로 쓰는 파일과 새 키 삽입에 쓴다. */
const CANONICAL: string[] = [
  K.flow,
  K.push,
  K.merge,
  K.publish,
  K.draft,
  K.limits,
  K.pushTargets,
  K.mergeTargets,
  K.confirm,
  K.activation,
  K.prefix,
  K.base,
  K.usePr,
  K.review,
  K.goal,
  K.outDir,
  K.adapter,
  K.hours,
  K.memo
]

const MODE_TEXT: Record<ApprovalMode, string> = {
  every: '매번 컨펌',
  batch: '묶음 컨펌',
  auto: '자동'
}
const LIMIT_LABEL: Record<LimitedAction, string> = { push: '푸시', merge: '머지', publish: '발행' }
const REVIEW_TEXT = { required: 'reviewer-qa 필수', recommended: '권장' } as const

/** 불변 규칙을 완화하는 줄의 키. 값이 `금지`/`항상 유지`가 아니면 무시하고 경고한다. */
const IMMUTABLE_KEYS: ReadonlySet<string> = new Set([
  '강제 푸시',
  '히스토리 재작성',
  '프로젝트 밖 쓰기',
  '프로젝트 폴더 삭제',
  '프로젝트 폴더 이동',
  '자격 증명 노출',
  '감사 기록',
  '킬 스위치',
  '일일 상한 해제'
])
const IMMUTABLE_OK: ReadonlySet<string> = new Set(['금지', '항상 유지'])

// ---- 값 검증 (파일 읽기와 저장 요청이 같은 규칙을 쓴다) ----

const MAX_LIST = 10
const MAX_HOURS = 100
const MAX_OUT_DIR = 100
const ADAPTER = /^[a-z0-9][a-z0-9-]{0,39}$/
const OUT_DIR = /^[A-Za-z0-9가-힣._-]+(\/[A-Za-z0-9가-힣._-]+)*\/?$/

export function okLine(v: unknown, max: number): v is string {
  return typeof v === 'string' && v.length <= max && v === v.trim() && !hasForbiddenChar(v)
}
export function okOutDir(v: unknown): v is string {
  return (
    okLine(v, MAX_OUT_DIR) && OUT_DIR.test(v) && v.split('/').every((s) => s !== '.' && s !== '..')
  )
}
/** 푸시 접두어는 `/`로 끝나야 한다 (`ma` 같은 비슬래시 접두어는 master 등과 겹친다). */
export function okPrefix(v: unknown): v is string {
  return (
    typeof v === 'string' &&
    v.length <= MAX_BRANCH &&
    v.endsWith('/') &&
    isValidBranch(v.slice(0, -1))
  )
}
export function okBranch(v: unknown): v is string {
  return typeof v === 'string' && isValidBranch(v)
}
export function okAdapter(v: unknown): v is string {
  return typeof v === 'string' && (v === 'manual' || ADAPTER.test(v))
}

export function defaultValues(type: ProjectType, defaultBranch: string | null): PolicyValues {
  return {
    flow:
      type === 'development'
        ? 'dev-git-pr'
        : type === 'content'
          ? 'content-draft-approve'
          : 'custom',
    modes: { push: 'every', merge: 'every', publish: 'every', 'draft-approve': 'every' },
    dailyLimits: {},
    autoPushPrefixes: [],
    autoMergeBranches: [],
    confirmInput: null,
    branchPrefix: 'feature/',
    baseBranch: defaultBranch !== null && okBranch(defaultBranch) ? defaultBranch : null,
    usePr: true,
    reviewStage: 'required',
    dailyOutputGoal: 0,
    outputDir: 'drafts/',
    publishAdapter: 'manual',
    activeHours: null,
    memo: null
  }
}

// ---- 자동 모드 요건 ----

export interface AutoProblem {
  code: Extract<
    PolicyWarningCode,
    | 'auto-limit-missing'
    | 'auto-limit-exceeded'
    | 'auto-target-missing'
    | 'auto-target-invalid'
    | 'auto-requirement-missing'
    | 'protected-merge-unconfirmed'
    | 'protected-limit-exceeded'
  >
  action: PolicyAction
  message: string
}

/** 동작 하나가 자동으로 유효하기 위한 값 조건 (활성화 기록은 별도). 문제가 없으면 빈 배열. */
export function autoProblems(
  v: PolicyValues,
  action: PolicyAction,
  projectName: string
): AutoProblem[] {
  const out: AutoProblem[] = []
  const add = (code: AutoProblem['code'], message: string): void => {
    out.push({ code, action, message })
  }
  const label = ACTION_LABEL[action]
  if (action !== 'draft-approve') {
    const limit = v.dailyLimits[action]
    const max = MAX_DAILY_LIMIT[action]
    if (limit === undefined)
      add('auto-limit-missing', `${label} 자동 모드에는 일일 상한이 필요해요.`)
    else if (!Number.isInteger(limit) || limit < 1 || limit > max)
      add('auto-limit-exceeded', `${label} 일일 상한은 1~${max}이어야 해요.`)
  }
  if (action === 'push') {
    if (v.autoPushPrefixes.length === 0)
      add('auto-target-missing', '자동 푸시를 허용할 브랜치 접두어가 필요해요.')
    else if (v.autoPushPrefixes.some((p) => hasRefPrefix(p) || prefixCoversProtected(p)))
      add('auto-target-invalid', '보호 브랜치나 ref 형태의 이름은 자동 푸시 대상으로 쓸 수 없어요.')
  }
  if (action === 'merge') {
    if (v.autoMergeBranches.length === 0)
      add('auto-target-missing', '자동 머지를 허용할 브랜치를 이름으로 적어야 해요.')
    else if (v.autoMergeBranches.some(hasRefPrefix))
      add(
        'auto-target-invalid',
        '자동 머지 대상은 refs/, heads/, origin/ 없이 브랜치 이름만 적어야 해요.'
      )
    if (!v.usePr || v.reviewStage !== 'required')
      add('auto-requirement-missing', '자동 머지는 PR 사용과 reviewer-qa 필수 검수가 있어야 해요.')
    if (v.autoMergeBranches.some(isProtectedBranch)) {
      if (v.confirmInput === null || v.confirmInput !== projectName)
        add(
          'protected-merge-unconfirmed',
          '보호 브랜치 자동 머지는 프로젝트 이름을 직접 입력해 확인해야 해요.'
        )
      const limit = v.dailyLimits.merge
      if (limit !== undefined && (limit < 1 || limit > PROTECTED_MERGE_MAX_DAILY))
        add(
          'protected-limit-exceeded',
          `보호 브랜치 자동 머지의 일일 상한은 1~${PROTECTED_MERGE_MAX_DAILY}이에요.`
        )
    }
  }
  if (action === 'publish' && v.publishAdapter === 'manual')
    add('auto-requirement-missing', '자동 발행은 수동(manual)이 아닌 발행 어댑터가 있어야 해요.')
  return out
}

/** 자동 설정이 바뀌면 활성화 기록이 무효가 되도록 설정의 지문을 만든다 (손으로 상한을 올리는 편집을 막는 장치). */
export function autoConfigHash(v: PolicyValues): string {
  const canon = JSON.stringify({
    m: POLICY_ACTIONS.map((a) => v.modes[a]),
    l: LIMITED_ACTIONS.map((a) => v.dailyLimits[a] ?? null),
    p: v.autoPushPrefixes,
    g: v.autoMergeBranches,
    c: v.confirmInput,
    r: v.usePr,
    s: v.reviewStage,
    a: v.publishAdapter
  })
  return createHash('sha256').update(canon).digest('hex').slice(0, 16)
}

export const hasAutoMode = (v: PolicyValues): boolean =>
  POLICY_ACTIONS.some((a) => v.modes[a] === 'auto')

// ---- 줄 값 파서 (잘못되면 undefined) ----

const modeFromText = (s: string): ApprovalMode | undefined =>
  APPROVAL_MODES.find((m) => MODE_TEXT[m] === s)

function parseLimits(s: string): PolicyValues['dailyLimits'] | undefined {
  const out: PolicyValues['dailyLimits'] = {}
  if (s === '') return out
  for (const part of s.split(',')) {
    const [k, n, ...rest] = part.split('=').map((x) => x.trim())
    const action = LIMITED_ACTIONS.find((a) => LIMIT_LABEL[a] === k)
    if (action === undefined || n === undefined || rest.length > 0 || !/^\d{1,4}$/.test(n))
      return undefined
    if (out[action] !== undefined) return undefined
    out[action] = Number(n)
  }
  return out
}

function parseList(s: string, ok: (v: string) => boolean): string[] | undefined {
  if (s === '') return []
  const items = s.split(',').map((x) => x.trim())
  if (items.length > MAX_LIST || items.some((x) => !ok(x))) return undefined
  return [...new Set(items)]
}

function parseActivation(s: string): (PolicyActivation & { hash: string }) | undefined {
  const [at, by, hash, ...rest] = s.split(' | ').map((x) => x.trim())
  if (rest.length > 0 || at === undefined || by === undefined || hash === undefined)
    return undefined
  if (!/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(at) || Number.isNaN(Date.parse(at))) return undefined
  if (by !== 'ceo-ui' && !/^D-\d{3,6}$/.test(by)) return undefined
  if (!/^[0-9a-f]{16}$/.test(hash)) return undefined
  return { at, by, hash }
}

export function formatActivation(a: PolicyActivation, hash: string): string {
  return `${a.at} | ${a.by} | ${hash}`
}

// ---- 문서 읽기 ----

export interface ParsedPolicy {
  values: PolicyValues
  effective: EffectivePolicy
  activation: PolicyActivation | null
  warnings: PolicyWarning[]
  history: PolicyHistoryEntry[]
  /** 파일에 적힌 활성화 기록 (유효성 판단 전). renderer로 보내지 않는다. */
  record: (PolicyActivation & { hash: string }) | null
}

function historyIndex(lines: string[]): number {
  return lines.findIndex((l) => l.trimEnd() === HISTORY_HEADING)
}

export function parseHistory(lines: string[]): PolicyHistoryEntry[] {
  const idx = historyIndex(lines)
  if (idx < 0) return []
  const out: PolicyHistoryEntry[] = []
  for (const raw of lines.slice(idx + 1)) {
    const line = raw.trimEnd()
    if (!line.startsWith('- ')) continue
    const [at, actor, ...rest] = line.slice(2).split(' | ')
    if (at !== undefined && actor !== undefined && rest.length > 0)
      out.push({ at, actor, summary: rest.join(' | ') })
  }
  return out
}

export function parsePolicy(
  text: string | null,
  project: { name: string; type: ProjectType; defaultBranch: string | null }
): ParsedPolicy {
  const values = defaultValues(project.type, project.defaultBranch)
  const warnings: PolicyWarning[] = []
  const warn = (code: PolicyWarningCode, message: string, field?: string): void => {
    warnings.push({ code, message, ...(field === undefined ? {} : { field }) })
  }
  const lines = text === null ? [] : text.split('\n').map((l) => l.replace(/\r$/, ''))
  const hIdx = historyIndex(lines)
  const body = hIdx < 0 ? lines : lines.slice(0, hIdx)

  const seen = new Set<string>()
  let activationRaw: ReturnType<typeof parseActivation> | null = null
  for (const line of body) {
    const f = parseFieldLine(line)
    if (f === null) continue
    if (IMMUTABLE_KEYS.has(f.key)) {
      if (!IMMUTABLE_OK.has(f.value))
        warn(
          'immutable-relaxed',
          '불변 규칙을 바꾸는 값은 무시해요. 이 항목은 항상 지켜져요.',
          f.key
        )
      continue
    }
    if (!KNOWN_KEYS.has(f.key)) continue
    if (seen.has(f.key)) {
      warn('duplicate-field', '같은 항목이 여러 번 있어 첫 줄만 써요.', f.key)
      continue
    }
    seen.add(f.key)
    const bad = (): void => warn('invalid-value', '허용되지 않는 값이라 기본값을 써요.', f.key)
    if (f.forged) {
      bad()
      continue
    }
    const v = f.value
    switch (f.key) {
      case K.flow: {
        const flow = POLICY_FLOWS.find((x) => x === v)
        if (flow) values.flow = flow
        else bad()
        break
      }
      case K.push:
      case K.merge:
      case K.publish:
      case K.draft: {
        const action = POLICY_ACTIONS.find((a) => ACTION_KEY[a] === f.key)
        const mode = modeFromText(v)
        if (action && mode) values.modes[action] = mode
        else bad()
        break
      }
      case K.limits: {
        const l = parseLimits(v)
        if (l) values.dailyLimits = l
        else bad()
        break
      }
      case K.pushTargets: {
        const l = parseList(v, okPrefix)
        if (l) values.autoPushPrefixes = l
        else bad()
        break
      }
      case K.mergeTargets: {
        const l = parseList(v, okBranch)
        if (l) values.autoMergeBranches = l
        else bad()
        break
      }
      case K.confirm:
        if (v === '') values.confirmInput = null
        else if (checkProjectName(v) === null) values.confirmInput = v
        else bad()
        break
      case K.activation: {
        const a = parseActivation(v)
        if (a) activationRaw = a
        else bad()
        break
      }
      case K.prefix:
        if (okPrefix(v)) values.branchPrefix = v
        else bad()
        break
      case K.base:
        if (v === '') values.baseBranch = null
        else if (okBranch(v)) values.baseBranch = v
        else bad()
        break
      case K.usePr:
        if (v === '예' || v === '아니오') values.usePr = v === '예'
        else bad()
        break
      case K.review: {
        const r = REVIEW_STAGES.find((x) => REVIEW_TEXT[x] === v)
        if (r) values.reviewStage = r
        else bad()
        break
      }
      case K.goal:
        if (/^\d{1,2}$/.test(v) && Number(v) <= MAX_DAILY_OUTPUT_GOAL)
          values.dailyOutputGoal = Number(v)
        else bad()
        break
      case K.outDir:
        if (okOutDir(v)) values.outputDir = v
        else bad()
        break
      case K.adapter:
        if (okAdapter(v)) values.publishAdapter = v
        else bad()
        break
      case K.hours:
        if (v === '') values.activeHours = null
        else if (okLine(v, MAX_HOURS)) values.activeHours = v
        else bad()
        break
      case K.memo:
        if (v === '') values.memo = null
        else if (okLine(v, MAX_POLICY_MEMO)) values.memo = v
        else bad()
        break
    }
  }

  const { effective, activation } = computeEffective(
    values,
    activationRaw ?? null,
    project.name,
    warn
  )
  return {
    values,
    effective,
    activation,
    warnings,
    history: parseHistory(lines),
    record: activationRaw ?? null
  }
}

/**
 * 자동 모드를 유효한 것만 남긴다. 활성화 기록이 없거나 설정이 기록 뒤에 바뀌었거나 요건이 빠지면 그 동작은 `every`로 대체한다.
 * 활성화 기록은 자동 동작이 하나라도 유효할 때만 `activation`으로 돌려준다.
 */
function computeEffective(
  v: PolicyValues,
  rec: (PolicyActivation & { hash: string }) | null,
  projectName: string,
  warn: (code: PolicyWarningCode, message: string, field?: string) => void
): { effective: EffectivePolicy; activation: PolicyActivation | null } {
  const modes = { ...v.modes }
  const limits: EffectivePolicy['dailyLimits'] = {}
  let activationOk = false
  const anyAuto = hasAutoMode(v)
  const stale = rec !== null && rec.hash !== autoConfigHash(v)
  if (anyAuto && rec === null)
    warn('auto-not-activated', '자동 모드는 CEO가 켠 기록이 있어야 해요. 매번 컨펌으로 처리해요.')
  else if (anyAuto && stale)
    warn(
      'auto-activation-stale',
      '자동 모드를 켠 뒤 설정이 바뀌었어요. CEO가 다시 켜기 전까지 매번 컨펌으로 처리해요.'
    )
  for (const a of POLICY_ACTIONS) {
    if (v.modes[a] !== 'auto') continue
    const problems = autoProblems(v, a, projectName)
    for (const p of problems) warn(p.code, p.message, ACTION_LABEL[a])
    if (rec === null || stale || problems.length > 0) {
      modes[a] = 'every'
      continue
    }
    activationOk = true
    const limit = a === 'draft-approve' ? undefined : v.dailyLimits[a]
    if (limit !== undefined && a !== 'draft-approve') limits[a] = limit
  }
  const mergeAuto = modes.merge === 'auto'
  const pushAuto = modes.push === 'auto'
  return {
    effective: {
      flow: v.flow,
      modes,
      dailyLimits: limits,
      autoPushPrefixes: pushAuto ? v.autoPushPrefixes : [],
      autoMergeBranches: mergeAuto ? v.autoMergeBranches : [],
      protectedMergeEnabled: mergeAuto && v.autoMergeBranches.some(isProtectedBranch),
      usePr: v.usePr,
      reviewStage: v.reviewStage
    },
    activation: activationOk && rec !== null ? { at: rec.at, by: rec.by } : null
  }
}

// ---- 문서 쓰기 ----

/** 값에서 줄 목록을 만든다. null이면 그 키의 줄을 지운다. */
function lineValues(v: PolicyValues, activation: string | null): Map<string, string | null> {
  const m = new Map<string, string | null>()
  m.set(K.flow, v.flow)
  for (const a of POLICY_ACTIONS) m.set(ACTION_KEY[a], MODE_TEXT[v.modes[a]])
  const limits = LIMITED_ACTIONS.filter((a) => v.dailyLimits[a] !== undefined)
    .map((a) => `${LIMIT_LABEL[a]}=${v.dailyLimits[a]}`)
    .join(', ')
  m.set(K.limits, limits === '' ? null : limits)
  m.set(K.pushTargets, v.autoPushPrefixes.length === 0 ? null : v.autoPushPrefixes.join(', '))
  m.set(K.mergeTargets, v.autoMergeBranches.length === 0 ? null : v.autoMergeBranches.join(', '))
  m.set(K.confirm, v.confirmInput)
  m.set(K.activation, activation)
  m.set(K.prefix, v.branchPrefix)
  m.set(K.base, v.baseBranch)
  m.set(K.usePr, v.usePr ? '예' : '아니오')
  m.set(K.review, REVIEW_TEXT[v.reviewStage])
  m.set(K.goal, String(v.dailyOutputGoal))
  m.set(K.outDir, v.outputDir)
  m.set(K.adapter, v.publishAdapter)
  m.set(K.hours, v.activeHours)
  m.set(K.memo, v.memo)
  return m
}

export function historyLine(e: PolicyHistoryEntry): string {
  return `- ${e.at} | ${e.actor} | ${e.summary}`
}

/** 기존 문서(없으면 새 문서)에 값을 반영하고 이력을 덧붙인다. 알 수 없는 줄과 이력은 그대로 둔다. */
export function serializePolicy(
  oldText: string | null,
  projectId: string,
  v: PolicyValues,
  activation: string | null,
  entries: PolicyHistoryEntry[]
): string {
  const want = lineValues(v, activation)
  const lines = oldText === null ? [] : oldText.split('\n')
  const hIdx = historyIndex(lines)
  const body = hIdx < 0 ? lines : lines.slice(0, hIdx)
  const tail = hIdx < 0 ? [] : lines.slice(hIdx)

  const done = new Set<string>()
  const out: string[] = []
  let lastKnown = -1
  for (const line of body) {
    const f = parseFieldLine(line)
    if (f !== null && want.has(f.key)) {
      if (done.has(f.key)) continue
      done.add(f.key)
      const val = want.get(f.key)
      if (val === null || val === undefined) continue
      out.push(formatFieldLine(f.key, val))
      lastKnown = out.length - 1
      continue
    }
    out.push(line)
  }
  const missing = CANONICAL.filter((k) => !done.has(k) && want.get(k) != null).map((k) =>
    formatFieldLine(k, want.get(k) as string)
  )
  if (missing.length > 0) {
    if (lastKnown >= 0) out.splice(lastKnown + 1, 0, ...missing)
    else {
      while (out.length > 0 && out[out.length - 1].trim() === '') out.pop()
      if (out.length === 0) out.push(`# 정책: ${projectId}`)
      out.push('', ...missing)
    }
  }
  while (out.length > 0 && out[out.length - 1].trim() === '') out.pop()

  const result = [...out, '']
  if (tail.length === 0) result.push(HISTORY_HEADING)
  else {
    while (tail.length > 0 && tail[tail.length - 1].trim() === '') tail.pop()
    result.push(...tail)
  }
  result.push(...entries.map(historyLine))
  return `${result.join('\n')}\n`
}

// ---- 변경 요약 (이력 한 줄) ----

/** 이전 값→새 값 요약. 메모는 내용 대신 "변경"만 적는다. 자동 모드 켬/끔은 항상 따로 적는다. */
export function summarizeChange(before: PolicyValues, after: PolicyValues): string[] {
  const parts: string[] = []
  if (before.flow !== after.flow) parts.push(`흐름: ${before.flow}→${after.flow}`)
  for (const a of POLICY_ACTIONS) {
    if (before.modes[a] === after.modes[a]) continue
    const turnedOn = after.modes[a] === 'auto'
    const turnedOff = before.modes[a] === 'auto'
    parts.push(
      `${ACTION_LABEL[a]}: ${MODE_TEXT[before.modes[a]]}→${MODE_TEXT[after.modes[a]]}${turnedOn ? ' (자동 모드 켬)' : turnedOff ? ' (자동 모드 끔)' : ''}`
    )
  }
  const eq = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)
  const show = (x: unknown): string =>
    x === null || x === undefined ? '없음' : String(x).replaceAll('|', '/')
  const lim = (v: PolicyValues): string =>
    LIMITED_ACTIONS.filter((a) => v.dailyLimits[a] !== undefined)
      .map((a) => `${LIMIT_LABEL[a]}=${v.dailyLimits[a]}`)
      .join(',') || '없음'
  if (!eq(before.dailyLimits, after.dailyLimits))
    parts.push(`일일 상한: ${lim(before)}→${lim(after)}`)
  const listOf = (l: string[]): string => (l.length === 0 ? '없음' : l.join(','))
  if (!eq(before.autoPushPrefixes, after.autoPushPrefixes))
    parts.push(
      `자동 푸시 대상: ${listOf(before.autoPushPrefixes)}→${listOf(after.autoPushPrefixes)}`
    )
  if (!eq(before.autoMergeBranches, after.autoMergeBranches))
    parts.push(
      `자동 머지 대상: ${listOf(before.autoMergeBranches)}→${listOf(after.autoMergeBranches)}`
    )
  const protBefore =
    before.modes.merge === 'auto' && before.autoMergeBranches.some(isProtectedBranch)
  const protAfter = after.modes.merge === 'auto' && after.autoMergeBranches.some(isProtectedBranch)
  if (protBefore !== protAfter)
    parts.push(
      protAfter ? '보호 브랜치 자동 머지 켬 (프로젝트 이름 입력 확인)' : '보호 브랜치 자동 머지 끔'
    )
  if (before.confirmInput !== after.confirmInput) parts.push('확인 입력 변경')
  const simple: [string, unknown, unknown][] = [
    ['브랜치 접두어', before.branchPrefix, after.branchPrefix],
    ['기반 브랜치', before.baseBranch, after.baseBranch],
    ['PR 사용', before.usePr ? '예' : '아니오', after.usePr ? '예' : '아니오'],
    ['검수 단계', REVIEW_TEXT[before.reviewStage], REVIEW_TEXT[after.reviewStage]],
    ['일일 산출 목표', before.dailyOutputGoal, after.dailyOutputGoal],
    ['산출물 폴더', before.outputDir, after.outputDir],
    ['발행 어댑터', before.publishAdapter, after.publishAdapter],
    ['활동 요일·시간', before.activeHours, after.activeHours]
  ]
  for (const [name, b, a] of simple) if (b !== a) parts.push(`${name}: ${show(b)}→${show(a)}`)
  if (before.memo !== after.memo) parts.push('메모 변경')
  return parts
}
