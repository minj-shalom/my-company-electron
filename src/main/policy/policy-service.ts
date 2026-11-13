import { createHash } from 'node:crypto'
import type { ApiResult, DomainErrorCode } from '../../shared/result'
import {
  APPROVAL_MODES,
  LIMITED_ACTIONS,
  MAX_DAILY_OUTPUT_GOAL,
  MAX_POLICY_BYTES,
  MAX_POLICY_MEMO,
  POLICY_ACTIONS,
  POLICY_FLOWS,
  REVIEW_STAGES,
  type PolicyHistoryEntry,
  type PolicySaveResult,
  type PolicyState,
  type PolicySummary,
  type PolicyValues,
  type PolicyViolation,
  type PolicyViolationCode
} from '../../shared/policy'
import { MAX_PROJECT_NAME, PROJECT_ID, checkProjectName } from '../../shared/project'
import { FsGuardError, type SafeFs } from '../repository/safe-fs'
import { readProjectItems } from '../project/assignments-store'
import type { DocProject } from '../project/project-doc'
import {
  autoConfigHash,
  autoProblems,
  formatActivation,
  hasAutoMode,
  okAdapter,
  okBranch,
  okLine,
  okOutDir,
  okPrefix,
  parsePolicy,
  serializePolicy,
  summarizeChange,
  type ParsedPolicy
} from './policy-doc'

export const POLICY_DIR = 'company/policies'
const MAX_LIST = 10
const MAX_HOURS = 100

/** 변경 주체. IPC(`policy:save`)는 항상 `ceo-ui`이고 제안 카드 적용은 `applyProposal`만 `proposal`을 만든다. 요청 본문이 정하지 못한다. */
export type PolicyActor =
  { kind: 'ceo-ui' } | { kind: 'proposal'; card: string } | { kind: 'agent' }

/** 불변 규칙을 완화하려는 요청 키. 어디에 있든 truthy면 저장을 거부한다. */
const IMMUTABLE_REQUEST_KEYS = [
  'forcePush',
  'allowForcePush',
  'rewriteHistory',
  'outsideWrite',
  'deleteProject',
  'moveProject',
  'exposeCredentials',
  'disableAudit',
  'disableKillSwitch',
  'unlimited',
  'noDailyLimit'
]

const fail = (code: DomainErrorCode, message: string): ApiResult<never> => ({
  ok: false,
  code,
  message
})
const policyPath = (id: string): string => `${POLICY_DIR}/${id}.md`
const revisionOf = (text: string | null): string =>
  text === null ? 'none' : createHash('sha256').update(text).digest('hex').slice(0, 32)

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const VALUE_KEYS = [
  'flow',
  'modes',
  'dailyLimits',
  'autoPushPrefixes',
  'autoMergeBranches',
  'confirmInput',
  'branchPrefix',
  'baseBranch',
  'usePr',
  'reviewStage',
  'dailyOutputGoal',
  'outputDir',
  'publishAdapter',
  'activeHours',
  'memo'
]

type Check = { values: PolicyValues } | { violations: PolicyViolation[] }

/** 저장 요청의 `values`를 형식·허용 값으로 검증한다. 자동 모드 요건과 변경 주체 규칙은 여기서 보지 않는다. */
export function checkValues(raw: unknown): Check {
  const violations: PolicyViolation[] = []
  const bad = (field: string, message = '허용되지 않는 값이에요.'): void => {
    violations.push({ code: 'invalid-value', field, message })
  }
  if (!isRecord(raw))
    return { violations: [{ code: 'invalid-value', message: '정책 값이 올바르지 않아요.' }] }
  const relax = (o: Record<string, unknown>): void => {
    for (const k of IMMUTABLE_REQUEST_KEYS)
      if (o[k] !== undefined && o[k] !== false && o[k] !== null)
        violations.push({
          code: 'immutable-relaxed',
          field: k,
          message: '불변 규칙은 정책으로 바꿀 수 없어요. 이 항목은 항상 지켜져요.'
        })
  }
  relax(raw)
  for (const k of Object.keys(raw))
    if (!VALUE_KEYS.includes(k) && !IMMUTABLE_REQUEST_KEYS.includes(k))
      bad(k, '알 수 없는 항목이에요.')
  if (violations.length > 0) return { violations }

  const flow = POLICY_FLOWS.find((f) => f === raw.flow)
  if (!flow) bad('flow')
  const modes = {} as PolicyValues['modes']
  if (
    isRecord(raw.modes) &&
    Object.keys(raw.modes).every((k) => (POLICY_ACTIONS as readonly string[]).includes(k))
  )
    for (const a of POLICY_ACTIONS) {
      const m = APPROVAL_MODES.find((x) => x === (raw.modes as Record<string, unknown>)[a])
      if (m) modes[a] = m
      else bad(`modes.${a}`)
    }
  else bad('modes')
  const dailyLimits: PolicyValues['dailyLimits'] = {}
  if (
    isRecord(raw.dailyLimits) &&
    Object.keys(raw.dailyLimits).every((k) => (LIMITED_ACTIONS as readonly string[]).includes(k))
  ) {
    for (const a of LIMITED_ACTIONS) {
      const n = raw.dailyLimits[a]
      if (n === undefined) continue
      // 상한 초과는 형식 오류가 아니라 자동 모드 요건 위반으로 따로 보고하므로 여기서는 정수 여부만 본다.
      if (typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 9999) dailyLimits[a] = n
      else bad(`dailyLimits.${a}`)
    }
  } else bad('dailyLimits')
  const list = (key: string, ok: (v: string) => boolean): string[] => {
    const v = raw[key]
    if (
      Array.isArray(v) &&
      v.length <= MAX_LIST &&
      v.every((x): x is string => typeof x === 'string' && ok(x)) &&
      new Set(v).size === v.length
    )
      return v
    bad(key)
    return []
  }
  const autoPushPrefixes = list('autoPushPrefixes', okPrefix)
  const autoMergeBranches = list('autoMergeBranches', okBranch)
  const nullableLine = (key: string, max: number, ok?: (v: string) => boolean): string | null => {
    const v = raw[key]
    if (v === null) return null
    if (okLine(v, max) && v.length > 0 && (ok === undefined || ok(v))) return v
    bad(key)
    return null
  }
  const confirmInput = nullableLine(
    'confirmInput',
    MAX_PROJECT_NAME * 2,
    (v) => checkProjectName(v) === null
  )
  const baseBranch = nullableLine('baseBranch', 100, okBranch)
  const activeHours = nullableLine('activeHours', MAX_HOURS)
  const memo = nullableLine('memo', MAX_POLICY_MEMO)
  if (!okPrefix(raw.branchPrefix)) bad('branchPrefix')
  if (typeof raw.usePr !== 'boolean') bad('usePr')
  const reviewStage = REVIEW_STAGES.find((r) => r === raw.reviewStage)
  if (!reviewStage) bad('reviewStage')
  const goal = raw.dailyOutputGoal
  if (
    typeof goal !== 'number' ||
    !Number.isInteger(goal) ||
    goal < 0 ||
    goal > MAX_DAILY_OUTPUT_GOAL
  )
    bad('dailyOutputGoal', `일일 산출 목표는 0~${MAX_DAILY_OUTPUT_GOAL}이에요.`)
  if (!okOutDir(raw.outputDir))
    bad('outputDir', '산출물 폴더는 프로젝트 폴더 안의 상대 경로여야 해요.')
  if (!okAdapter(raw.publishAdapter)) bad('publishAdapter')
  if (violations.length > 0 || !flow || !reviewStage) return { violations }
  return {
    values: {
      flow,
      modes,
      dailyLimits,
      autoPushPrefixes,
      autoMergeBranches,
      confirmInput,
      branchPrefix: raw.branchPrefix as string,
      baseBranch,
      usePr: raw.usePr as boolean,
      reviewStage,
      dailyOutputGoal: goal as number,
      outputDir: raw.outputDir as string,
      publishAdapter: raw.publishAdapter as string,
      activeHours,
      memo
    }
  }
}

const actorLabel = (a: PolicyActor): string =>
  a.kind === 'ceo-ui' ? 'CEO 직접' : a.kind === 'proposal' ? `제안 ${a.card}` : '에이전트'

export interface PolicyServiceDeps {
  fs: SafeFs
  /** 결정 resolve, 티켓 이동, 프로젝트·직원 변경과 같은 쓰기 직렬화 큐. */
  exclusive: <T>(task: () => Promise<T>) => Promise<T>
  now?: () => Date
}

class Stop extends Error {
  constructor(readonly result: ApiResult<never>) {
    super('stop')
  }
}

/**
 * 프로젝트 작업 흐름 정책(T-047)의 읽기·저장. 마크다운이 원본이다.
 * 이 서비스는 값의 검증·기록까지만 한다. 자동 모드의 실행 시 강제(상한 계산, 킬 스위치, 감사)는 T-053 게이트가 한다.
 */
export class PolicyService {
  constructor(private readonly deps: PolicyServiceDeps) {}

  private async project(id: unknown): Promise<DocProject> {
    if (typeof id !== 'string' || !PROJECT_ID.test(id))
      throw new Stop(fail('invalid-request', '프로젝트 id가 올바르지 않습니다.'))
    let items: DocProject[]
    try {
      items = await readProjectItems(this.deps.fs)
    } catch {
      throw new Stop(fail('internal', '프로젝트 목록을 읽지 못했습니다.'))
    }
    const p = items.find((x) => x.id === id)
    if (p === undefined) throw new Stop(fail('not-found', '등록된 프로젝트가 아닙니다.'))
    return p
  }

  private async readText(id: string): Promise<string | null> {
    try {
      const text = await this.deps.fs.readText(policyPath(id))
      if (Buffer.byteLength(text, 'utf8') > MAX_POLICY_BYTES)
        throw new Stop(fail('internal', '정책 파일이 너무 커서 읽지 않았어요.'))
      return text
    } catch (e) {
      if (e instanceof Stop) throw e
      if (e instanceof FsGuardError && e.kind === 'missing') return null
      throw new Stop(fail('internal', '정책 파일을 읽을 수 없습니다.'))
    }
  }

  /** 활성화 기록 원문(`record`)은 renderer로 보내지 않으므로 필드를 골라 담는다. */
  private state(p: DocProject, text: string | null): { state: PolicyState; parsed: ParsedPolicy } {
    const parsed = parsePolicy(text, p)
    const { values, effective, activation, warnings, history } = parsed
    return {
      parsed,
      state: {
        projectId: p.id,
        exists: text !== null,
        revision: revisionOf(text),
        values,
        effective,
        activation,
        warnings,
        history
      }
    }
  }

  private async guard<T>(fn: () => Promise<ApiResult<T>>): Promise<ApiResult<T>> {
    try {
      return await fn()
    } catch (e) {
      return e instanceof Stop ? e.result : fail('internal', '요청을 처리하지 못했습니다.')
    }
  }

  /** 정책이 없으면 유형별 보수적 기본값(모든 동작 `매번 컨펌`)을 돌려준다. 정책 파일은 만들지 않는다. */
  get(raw: unknown): Promise<ApiResult<PolicyState>> {
    return this.guard(async () => {
      const id = isRecord(raw) ? raw.projectId : undefined
      const p = await this.project(id)
      return { ok: true as const, value: this.state(p, await this.readText(p.id)).state }
    })
  }

  /** 프로젝트 목록 배지·방문 요약용. 읽지 못한 정책은 보수적 기본값으로 센다. */
  listSummaries(): Promise<ApiResult<PolicySummary[]>> {
    return this.guard(async () => {
      let items: DocProject[]
      try {
        items = await readProjectItems(this.deps.fs)
      } catch {
        return fail('internal', '프로젝트 목록을 읽지 못했습니다.')
      }
      const out: PolicySummary[] = []
      for (const p of items) {
        let text: string | null = null
        let unreadable = false
        try {
          text = await this.readText(p.id)
        } catch {
          unreadable = true
        }
        const { effective, warnings } = parsePolicy(text, p)
        out.push({
          projectId: p.id,
          exists: text !== null,
          autoActions: POLICY_ACTIONS.filter((a) => effective.modes[a] === 'auto'),
          protectedMergeEnabled: effective.protectedMergeEnabled,
          warningCount: warnings.length + (unreadable ? 1 : 0)
        })
      }
      return { ok: true as const, value: out }
    })
  }

  /** CEO UI 경로 (IPC `policy:save`). */
  save(raw: unknown): Promise<ApiResult<PolicySaveResult>> {
    return this.apply(raw, { kind: 'ceo-ui' })
  }

  /** 승인된 `policy-change` 제안 카드(T-046) 적용 경로. UI 없이 호출하며 자동 활성화에는 카드 번호가 기록된다. */
  applyProposal(raw: unknown, card: string): Promise<ApiResult<PolicySaveResult>> {
    if (!/^D-\d{3,6}$/.test(card))
      return Promise.resolve(fail('invalid-request', '결정 카드 번호가 올바르지 않습니다.'))
    return this.apply(raw, { kind: 'proposal', card })
  }

  /** `agent` 경로는 자동 모드를 켜거나 바꿀 수 없다 (그 외 값 검증은 같다). */
  apply(raw: unknown, actor: PolicyActor): Promise<ApiResult<PolicySaveResult>> {
    return this.guard<PolicySaveResult>(async () => {
      if (!isRecord(raw)) return fail('invalid-request', '요청이 올바르지 않습니다.')
      if (typeof raw.revision !== 'string' || raw.revision.length === 0 || raw.revision.length > 64)
        return fail('invalid-request', 'revision이 올바르지 않습니다.')
      if (raw.confirmAuto !== undefined && typeof raw.confirmAuto !== 'boolean')
        return fail('invalid-request', 'confirmAuto가 올바르지 않습니다.')
      const req = {
        projectId: raw.projectId,
        revision: raw.revision,
        confirmAuto: raw.confirmAuto === true,
        values: raw.values
      }
      return this.deps.exclusive(async () => {
        const p = await this.project(req.projectId)
        const checked = checkValues(req.values)
        if ('violations' in checked)
          return {
            ok: true as const,
            value: { saved: false as const, violations: checked.violations }
          }
        const values = checked.values

        const old = await this.readText(p.id)
        if (revisionOf(old) !== req.revision)
          return fail('conflict', '정책이 다른 곳에서 바뀌었어요. 다시 불러온 뒤 시도하세요.')
        const before = parsePolicy(old, p)

        const violations: PolicyViolation[] = []
        for (const a of POLICY_ACTIONS)
          if (values.modes[a] === 'auto')
            for (const pr of autoProblems(values, a, p.name))
              violations.push({
                code: pr.code as PolicyViolationCode,
                field: pr.action,
                message: pr.message
              })

        const auto = hasAutoMode(values)
        const hash = autoConfigHash(values)
        // 설정 지문이 기존 기록과 같으면 자동 모드를 새로 켠 것이 아니다 (기록을 그대로 둔다).
        const unchangedAuto = auto && before.record !== null && before.record.hash === hash
        const needsNewRecord = auto && !unchangedAuto
        if (needsNewRecord && actor.kind === 'agent')
          violations.push({
            code: 'auto-needs-ceo',
            message: '자동 모드는 CEO만 켜거나 바꿀 수 있어요.'
          })
        else if (needsNewRecord && actor.kind === 'ceo-ui' && !req.confirmAuto)
          violations.push({
            code: 'auto-needs-confirm',
            message: '자동 모드를 켜려면 경고 내용을 확인해야 해요.'
          })
        if (violations.length > 0)
          return { ok: true as const, value: { saved: false as const, violations } }

        const at = (this.deps.now?.() ?? new Date()).toISOString()
        let activation: string | null = null
        if (unchangedAuto && before.record !== null)
          activation = formatActivation(before.record, hash)
        else if (needsNewRecord)
          activation = formatActivation(
            { at, by: actor.kind === 'proposal' ? actor.card : 'ceo-ui' },
            hash
          )

        if (
          old !== null &&
          JSON.stringify(values) === JSON.stringify(before.values) &&
          (activation === null) === (before.record === null)
        )
          return {
            ok: true as const,
            value: { saved: true as const, state: this.state(p, old).state }
          }

        const parts = summarizeChange(before.values, values)
        if (parts.length === 0 && activation !== null && !unchangedAuto)
          parts.push('자동 모드 다시 켬')
        const entry: PolicyHistoryEntry = {
          at,
          actor: actorLabel(actor),
          summary:
            (old === null ? '정책 생성: ' : '') + (parts.join('; ') || '변경 없음 (자동 기록 정리)')
        }
        const out = serializePolicy(old, p.id, values, activation, [entry])
        if (Buffer.byteLength(out, 'utf8') > MAX_POLICY_BYTES)
          return {
            ok: true as const,
            value: {
              saved: false as const,
              violations: [
                {
                  code: 'file-too-large' as const,
                  message: '정책 파일이 너무 커져서 저장하지 않았어요.'
                }
              ]
            }
          }
        // 직렬화가 어긋났거나 위조 문자가 섞였다면 쓰기 전에 막는다.
        const again = parsePolicy(out, p)
        if (
          JSON.stringify(again.values) !== JSON.stringify(values) ||
          again.warnings.some((w) => w.code === 'invalid-value')
        )
          return fail('invalid-request', '변경 내용을 올바르게 저장할 수 없어 취소했습니다.')

        // 쓰기 직전에 원본이 그대로인지 다시 확인한다 (CLI 에이전트의 동시 수정 대비).
        if ((await this.readText(p.id)) !== old)
          return fail('conflict', '정책이 동시에 수정되고 있습니다. 다시 시도하세요.')
        try {
          await this.deps.fs.writeText(policyPath(p.id), out, old !== null)
        } catch (e) {
          if (e instanceof FsGuardError && e.kind === 'exists')
            return fail('conflict', '정책이 동시에 수정되고 있습니다. 다시 시도하세요.')
          return fail('internal', '정책 파일을 쓰지 못했습니다.')
        }
        const verified = await this.deps.fs.readText(policyPath(p.id)).then(
          (t) => t === out,
          () => false
        )
        if (!verified) {
          try {
            if (old === null) await this.deps.fs.remove(policyPath(p.id))
            else await this.deps.fs.writeText(policyPath(p.id), old)
          } catch {
            return fail(
              'internal',
              '쓴 내용을 확인하지 못했고 되돌리지도 못했습니다. 정책 파일을 확인하세요.'
            )
          }
          return fail('internal', '쓴 내용을 확인하지 못해 되돌렸습니다.')
        }
        return {
          ok: true as const,
          value: { saved: true as const, state: this.state(p, out).state }
        }
      })
    })
  }
}
