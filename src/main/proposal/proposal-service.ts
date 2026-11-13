import { MAX_PROPOSAL_ACTIONS } from '../../shared/proposal'
import type {
  ProposalAction,
  ProposalApplyResult,
  ProposalFailureCode
} from '../../shared/proposal'
import type { Decision } from '../../shared/decision'
import type { ApiResult } from '../../shared/result'
import type { EmployeeService } from '../employee/employee-service'
import type { IntegrityService } from '../integrity/integrity-service'
import {
  DELETED_HASH,
  isProtectedPath,
  readProtectedFiles,
  sha256
} from '../integrity/protected-files'
import type { PolicyService } from '../policy/policy-service'
import type { ProjectService } from '../project/project-service'
import { DECISION_ID } from '../repository/ids'
import { DECISION_DIRS } from '../repository/parse-decision'
import type { SafeFs } from '../repository/safe-fs'
import { extractProposalBlocks, parseProposalBlock } from './proposal-block'

export interface ProposalRepo {
  getDecision(id: string): Promise<ApiResult<Decision>>
  resolveDecision(req: { id: string; choice: string; memo?: string }): Promise<ApiResult<Decision>>
}

export interface ProposalDeps {
  fs: SafeFs
  exclusive: <T>(task: () => Promise<T>) => Promise<T>
  repo: ProposalRepo
  /** 이 카드 번호에 묶인 직원 서비스. 서비스의 승인 확인은 "지금 적용 중인 이 카드"만 인정한다. */
  employeeFor: (cardId: string) => EmployeeService
  project: ProjectService
  policy: PolicyService
  integrity: IntegrityService
}

const agentPath = (id: string): string => `.claude/agents/${id}.md`

/** `proposal` 카드의 선택지 계약: A 승인, B 거절. 다른 모양은 적용 버튼을 비활성화한다. */
const APPROVE = { key: 'A', label: '승인' }
const REJECT = { key: 'B', label: '거절' }
const CARD_PROPOSERS: ReadonlySet<string> = new Set(['hr', 'coo'])

const failed = (code: ProposalFailureCode): ProposalApplyResult => ({ ok: false, code })
const done = (
  status: Extract<ProposalApplyResult, { ok: true }>['status'],
  applied?: number
): ProposalApplyResult => ({ ok: true, status, ...(applied === undefined ? {} : { applied }) })

type Parsed =
  { ok: true; request: { id: string; choice: string; stateHash?: string } } | { ok: false }

/** renderer 요청: 알 수 없는 키는 거부한다 (적용 대상이나 값은 요청이 아니라 카드가 정한다). */
export function parseApplyRequest(raw: unknown): Parsed {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false }
  const proto = Object.getPrototypeOf(raw) as unknown
  if (proto !== Object.prototype && proto !== null) return { ok: false }
  const o = raw as Record<string, unknown>
  if (!Object.keys(o).every((k) => k === 'id' || k === 'choice' || k === 'stateHash'))
    return { ok: false }
  if (typeof o.id !== 'string' || !DECISION_ID.test(o.id)) return { ok: false }
  if (typeof o.choice !== 'string' || o.choice.length === 0 || o.choice.length > 20)
    return { ok: false }
  if (
    o.stateHash !== undefined &&
    (typeof o.stateHash !== 'string' || !/^[0-9a-f]{64}$/.test(o.stateHash))
  )
    return { ok: false }
  return { ok: true, request: { id: o.id, choice: o.choice, stateHash: o.stateHash } }
}

/** 카드가 적용 가능한 `proposal` 카드인지 확인하고 액션을 돌려준다. 하나라도 어긋나면 null. */
export function actionsOf(card: Decision): ProposalAction[] | null {
  if (card.kind !== 'proposal' || card.proposedBy === undefined || card.proposedBy === null)
    return null
  if (!CARD_PROPOSERS.has(card.proposedBy)) return null
  const [a, b, ...rest] = card.options
  if (
    a?.key !== APPROVE.key ||
    a.label !== APPROVE.label ||
    b?.key !== REJECT.key ||
    b.label !== REJECT.label ||
    rest.length > 0
  )
    return null
  const blocks = extractProposalBlocks(card.question)
  if (blocks.length !== 1) return null
  const parsed = parseProposalBlock(blocks[0])
  return parsed.ok && parsed.actions.length <= MAX_PROPOSAL_ACTIONS ? parsed.actions : null
}

export class ProposalService {
  private chain: Promise<unknown> = Promise.resolve()

  constructor(private readonly deps: ProposalDeps) {}

  /** 결재함의 승인/거절 클릭 이벤트가 부르는 유일한 진입점. 같은 카드가 동시에 두 번 적용되지 않도록 한 줄로 세운다. */
  apply(raw: unknown): Promise<ApiResult<ProposalApplyResult>> {
    const req = parseApplyRequest(raw)
    if (!req.ok)
      return Promise.resolve({
        ok: false,
        code: 'invalid-request',
        message: '요청이 올바르지 않습니다.'
      })
    const run = this.chain.then(
      () => this.applyNow(req.request),
      () => this.applyNow(req.request)
    )
    this.chain = run.catch(() => undefined)
    return run
  }

  private async applyNow(req: {
    id: string
    choice: string
    stateHash?: string
  }): Promise<ApiResult<ProposalApplyResult>> {
    try {
      const found = await this.deps.repo.getDecision(req.id)
      if (!found.ok) return found
      return { ok: true, value: await this.dispatch(found.value, req) }
    } catch {
      return { ok: true, value: failed('failed') }
    }
  }

  private async dispatch(
    card: Decision,
    req: { id: string; choice: string; stateHash?: string }
  ): Promise<ProposalApplyResult> {
    if (!card.options.some((o) => o.key === req.choice)) return failed('not-actionable')
    if (card.kind === 'proposal') return this.proposal(card, req.choice)
    if (card.kind === 'integrity-warning' || card.kind === 'revert-suggestion')
      return this.integrityCard(card, req)
    return failed('not-actionable')
  }

  // ---- proposal ----

  private async proposal(card: Decision, choice: string): Promise<ProposalApplyResult> {
    const actions = actionsOf(card)
    if (card.status === 'done') {
      // 멱등: 이미 처리된 카드는 다시 적용하지 않는다.
      if (card.chosen === APPROVE.key) return done('already-applied')
      if (card.chosen === REJECT.key) return done('already-rejected')
      return failed('not-actionable')
    }
    if (choice === REJECT.key) {
      // 거절은 적용 내용을 해석하지 않으므로 알 수 없는 액션이 든 카드도 거절할 수 있다.
      return (await this.resolve(card.id, REJECT.key, '거절')) ? done('rejected') : failed('failed')
    }
    if (choice !== APPROVE.key || actions === null) return failed('not-actionable')

    const stale = await this.preflight(actions)
    if (stale !== null) return this.stop(card.id, stale)

    const outcome = await this.deps.integrity.withAppWrite(
      'approved-proposal',
      () => this.applyActions(card.id, actions),
      card.id
    )
    if (outcome.ok === false) return this.stop(card.id, outcome.code)
    const status = actions.every((a) => isApprovalOnly(a)) ? 'approved-pending-edit' : 'applied'
    // 적용이 성공한 뒤에만 카드를 옮긴다. 옮기지 못하면 pending에 남기고 오류 메모를 적는다.
    if (
      !(await this.resolve(card.id, APPROVE.key, `앱이 ${actions.length}개 변경을 적용했습니다.`))
    )
      return this.stop(card.id, 'failed')
    return done(status, actions.length)
  }

  /**
   * 승인 시점의 기준값·존재 확인. 어긋나면 아무것도 쓰지 않고 `stale`로 거부해 다시 제안하게 한다.
   * 제안 이후 직원이 생기거나 사라졌다면 제안의 전제가 달라진 것이다.
   */
  private async preflight(actions: ProposalAction[]): Promise<ProposalFailureCode | null> {
    for (const a of actions) {
      if (a.action === 'hire') {
        if (await this.deps.fs.exists(agentPath(a.id))) return 'stale'
        continue
      }
      if (a.action !== 'update' && a.action !== 'move' && a.action !== 'retire') continue
      if (!(await this.deps.fs.exists(agentPath(a.id)))) return 'stale'
      if (a.action === 'update' && a.base !== undefined && (await this.agentHash(a.id)) !== a.base)
        return 'stale'
    }
    return null
  }

  private async agentHash(id: string): Promise<string> {
    try {
      return sha256(await this.deps.fs.readText(agentPath(id)))
    } catch {
      return DELETED_HASH
    }
  }

  /** 묶음 적용: 하나라도 실패하면 보호 대상 파일을 시작 상태로 되돌린다 (전부 또는 롤백). */
  private async applyActions(
    cardId: string,
    actions: ProposalAction[]
  ): Promise<{ ok: true } | { ok: false; code: ProposalFailureCode }> {
    const before = await readProtectedFiles(this.deps.fs)
    const employee = this.deps.employeeFor(cardId)
    const approvals: Array<{ file: string; base: string; after: string }> = []
    let code: ProposalFailureCode | null = null
    for (const a of actions) {
      code = await this.applyOne(a, cardId, employee, approvals)
      if (code !== null) break
    }
    if (code === null) {
      for (const a of actions) {
        if (a.action !== 'update' || a.after === undefined || isApprovalOnly(a)) continue
        if ((await this.agentHash(a.id)) !== a.after) code = 'hash-mismatch'
      }
    }
    if (code !== null) return this.undo(before, code)
    // 승인 레코드는 모든 적용이 성공한 뒤에만 저장한다 (T-052가 승인 해시와 대조한다).
    const saved: Array<{ file: string; base: string; after: string }> = []
    for (const ap of approvals) {
      try {
        await this.deps.integrity.approve(ap.file, ap.base, ap.after)
        saved.push(ap)
      } catch {
        // 승인 기록을 못 남기면 적용분도 남기지 않고, 앞서 저장한 기록은 지운다 (기록 없는 변경은 미승인으로 감지된다).
        await this.revokeApprovals(saved)
        return this.undo(before, 'failed')
      }
    }
    return { ok: true }
  }

  /** 정리는 최선을 다하되 실패해도 던지지 않는다 (남은 기록은 7일 뒤 만료되고, 해시가 맞아야만 쓰인다). */
  private async revokeApprovals(
    saved: ReadonlyArray<{ file: string; base: string; after: string }>
  ): Promise<void> {
    for (const ap of saved)
      await this.deps.integrity.unapprove(ap.file, ap.base, ap.after).catch(() => undefined)
  }

  private async applyOne(
    a: ProposalAction,
    cardId: string,
    employee: EmployeeService,
    approvals: Array<{ file: string; base: string; after: string }>
  ): Promise<ProposalFailureCode | null> {
    const actor = 'approved-proposal' as const
    switch (a.action) {
      case 'assign':
        return fromResult(
          await this.deps.project.assignEmployee({ id: a.project, employeeId: a.employee })
        )
      case 'unassign':
        return fromResult(
          await this.deps.project.unassignEmployee({ id: a.project, employeeId: a.employee })
        )
      case 'hire':
        return fromResult(
          await employee.create(
            {
              templateId: a.template,
              id: a.id,
              department: a.department,
              reportsTo: a.reportsTo,
              ...(a.title === undefined ? {} : { title: a.title }),
              ...(a.role === undefined ? {} : { role: a.role }),
              approval: cardId
            },
            actor
          )
        )
      case 'move':
        return fromResult(
          await employee.move(
            {
              id: a.id,
              ...(a.department === undefined ? {} : { department: a.department }),
              ...(a.reportsTo === undefined ? {} : { reportsTo: a.reportsTo }),
              ...(a.title === undefined ? {} : { title: a.title }),
              ...(a.role === undefined ? {} : { role: a.role }),
              approval: cardId
            },
            actor
          )
        )
      case 'retire':
        return fromResult(await employee.retire({ id: a.id, approval: cardId }, actor))
      case 'update': {
        if (isApprovalOnly(a)) {
          if (a.base === undefined || a.after === undefined) return 'not-actionable'
          approvals.push({ file: `.claude/agents/${a.id}.md`, base: a.base, after: a.after })
          return null
        }
        return fromResult(
          await employee.update(
            {
              id: a.id,
              ...(a.description === undefined ? {} : { description: a.description }),
              ...(a.model === undefined ? {} : { model: a.model }),
              ...(a.tools === undefined ? {} : { tools: a.tools }),
              approval: cardId
            },
            actor
          )
        )
      }
      case 'policy-change': {
        const r = await this.deps.policy.applyProposal(
          { projectId: a.project, revision: a.revision, values: a.values },
          cardId
        )
        if (!r.ok) return r.code === 'conflict' ? 'stale' : fromResult(r)
        if (r.value.saved) return null
        return r.value.violations.some((v) => v.code === 'immutable-relaxed')
          ? 'protected'
          : 'rejected-by-rule'
      }
    }
  }

  private async undo(
    before: Awaited<ReturnType<typeof readProtectedFiles>>,
    code: ProposalFailureCode
  ): Promise<{ ok: false; code: ProposalFailureCode }> {
    return { ok: false, code: (await this.rollback(before)) ? code : 'rollback-failed' }
  }

  /**
   * 보호 대상 파일(직원, org.md, project.md, archive, `company/policies/**`)을 시작 상태로 되돌린다.
   * 앱 함수가 쓰는 곳은 이 범위가 전부다: policy-change도 `company/policies/**`만 쓰므로 범위 밖에 쓰지 않는다.
   * 복구가 하나라도 실패하면 false를 돌려준다 (삼키지 않는다).
   */
  private async rollback(before: Awaited<ReturnType<typeof readProtectedFiles>>): Promise<boolean> {
    let clean = true
    const attempt = async (task: Promise<void>): Promise<void> => {
      try {
        await task
      } catch {
        clean = false
      }
    }
    try {
      const now = await readProtectedFiles(this.deps.fs)
      await this.deps.exclusive(async () => {
        for (const [f, s] of now) {
          if (before.get(f)?.hash === s.hash || !isProtectedPath(f)) continue
          const prev = before.get(f)
          if (prev === undefined) await attempt(this.deps.fs.remove(f))
          else if (prev.text !== null) await attempt(this.deps.fs.writeText(f, prev.text))
          else clean = false
        }
        for (const [f, s] of before) {
          if (now.has(f) || !isProtectedPath(f)) continue
          if (s.text === null) clean = false
          else await attempt(this.deps.fs.writeText(f, s.text))
        }
      })
    } catch {
      clean = false
    }
    return clean
  }

  // ---- integrity-warning / revert-suggestion ----

  private async integrityCard(
    card: Decision,
    req: { id: string; choice: string; stateHash?: string }
  ): Promise<ProposalApplyResult> {
    if (card.status === 'done') return failed('not-actionable')
    const label = card.options.find((o) => o.key === req.choice)?.label ?? ''
    const svc = this.deps.integrity
    const needsHash = label === '되돌리기' || label === '복원' || label === '사후 승인'
    let stateHash = req.stateHash
    if (needsHash) {
      // 상태 해시는 카드 본문(앱이 쓴 영향 줄)에서 직접 읽는다. 누락되면 거부하고 요청 값이 다르면 stale이다.
      const fromCard = await this.cardStateHash(card.id)
      if (fromCard === null) return failed('not-actionable')
      if (stateHash !== undefined && stateHash !== fromCard) return this.stop(card.id, 'stale')
      stateHash = fromCard
    }
    if (label === '되돌리기' || label === '복원') {
      const r = await svc.restore(stateHash)
      if (!r.ok)
        return this.stop(
          card.id,
          r.code === 'stale' ? 'stale' : r.code === 'busy' ? 'busy' : 'failed'
        )
      return (await this.resolve(card.id, req.choice, '앱이 마지막 정상 상태로 복원했습니다.'))
        ? done('restored')
        : this.stop(card.id, 'failed')
    }
    if (label === '사후 승인' && card.kind === 'revert-suggestion') {
      const r = await svc.accept(stateHash)
      if (!r.ok)
        return this.stop(
          card.id,
          r.code === 'stale' ? 'stale' : r.code === 'busy' ? 'busy' : 'failed'
        )
      return (await this.resolve(card.id, req.choice, '변경을 승인하고 격리를 해제했습니다.'))
        ? done('accepted')
        : this.stop(card.id, 'failed')
    }
    if (label === '그대로 두기' || label === '확인')
      return (await this.resolve(card.id, req.choice, '확인했습니다.'))
        ? done('dismissed')
        : failed('failed')
    return failed('not-actionable')
  }

  // ---- 카드 처리 ----

  private async cardStateHash(id: string): Promise<string | null> {
    const { files } = await this.deps.fs.listMarkdown(DECISION_DIRS.pending)
    const name = files.find((f) => f.startsWith(`${id}-`) || f === `${id}.md`)
    if (name === undefined) return null
    const text = await this.deps.fs.readText(`${DECISION_DIRS.pending}/${name}`)
    const all = [...text.matchAll(/상태 해시: ([0-9a-f]{64})(?![0-9a-f])/g)]
    // 해시가 둘 이상이면 어느 것이 앱이 쓴 값인지 알 수 없으므로 거부한다.
    return all.length === 1 ? all[0][1] : null
  }

  private async resolve(id: string, choice: string, memo: string): Promise<boolean> {
    const r = await this.deps.repo.resolveDecision({ id, choice, memo })
    return r.ok
  }

  /** 실패한 카드는 pending에 남기고 고정 코드만 오류 메모로 적는다 (내부 경로나 오류 원문은 쓰지 않는다). */
  private async stop(id: string, code: ProposalFailureCode): Promise<ProposalApplyResult> {
    await this.noteError(id, code).catch(() => undefined)
    return failed(code)
  }

  private async noteError(id: string, code: ProposalFailureCode): Promise<void> {
    await this.deps.exclusive(async () => {
      const { files } = await this.deps.fs.listMarkdown(DECISION_DIRS.pending)
      const name = files.find((f) => f.startsWith(`${id}-`) || f === `${id}.md`)
      if (name === undefined) return
      const path = `${DECISION_DIRS.pending}/${name}`
      const text = await this.deps.fs.readText(path)
      const marker = '\n## 처리 오류\n'
      const head = text.includes(marker)
        ? text.slice(0, text.indexOf(marker))
        : text.replace(/\n*$/, '\n')
      await this.deps.fs.writeText(path, `${head}${marker}- 코드: ${code}\n`)
    })
  }
}

/** 변경 필드 없이 승인 해시만 담은 `update`: hr이 같은 내용을 재편집하는 경로다. */
function isApprovalOnly(a: ProposalAction): boolean {
  return (
    a.action === 'update' &&
    a.description === undefined &&
    a.model === undefined &&
    a.tools === undefined
  )
}

function fromResult(r: ApiResult<unknown>): ProposalFailureCode | null {
  if (r.ok) return null
  switch (r.code) {
    case 'conflict':
    case 'not-found':
    case 'invalid-request':
      return 'rejected-by-rule'
    case 'forbidden':
    case 'approval-required':
      return 'protected'
    default:
      return 'failed'
  }
}
