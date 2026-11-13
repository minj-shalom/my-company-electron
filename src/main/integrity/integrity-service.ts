import type { ChangeActor, IntegrityActionResult, IntegrityIssue } from '../../shared/integrity'
import type { GateCards } from '../gate/gate-cards'
import type { SafeFs } from '../repository/safe-fs'
import { HrAudit, summarizeDiff, type HrAuditEntry } from './hr-audit'
import type { IntegrityStateStore } from './integrity-state'
import {
  DELETED_HASH,
  diffMaps,
  filesWithSecrets,
  isPolicyPath,
  isProtectedPath,
  readProtectedFiles,
  sha256,
  type FileMap
} from './protected-files'
import { judgeSensitive, type SensitiveChange } from './sensitive'
import type { Snapshot, SnapshotStore } from './snapshot-store'
import { validateAll } from './validators'

export interface IntegrityDeps {
  fs: SafeFs
  exclusive: <T>(task: () => Promise<T>) => Promise<T>
  snapshots: SnapshotStore
  state: IntegrityStateStore
  audit: HrAudit
  cards: GateCards
  now?: () => Date
}

export type ReconcileStatus = 'initialized' | 'unchanged' | 'clean' | 'flagged' | 'skipped'

export interface ReconcileResult {
  status: ReconcileStatus
  cardIds: string[]
  issues: IntegrityIssue[]
}

interface Plan {
  changed: string[]
  actors: Map<string, ChangeActor>
  issues: IntegrityIssue[]
  sensitive: SensitiveChange[]
}

const APP_ACTORS: ReadonlySet<ChangeActor> = new Set(['ceo-ui', 'approved-proposal'])
/** 설정 변경 성격의 위반은 되돌리기 제안(`revert-suggestion`), 그 밖은 경고(`integrity-warning`)로 알린다. */
const REVERT_CODES: ReadonlySet<string> = new Set([
  'project-line-changed',
  'project-block-unreadable',
  'policy-changed',
  'sensitive-change'
])

const stateHash = (f: FileMap): string =>
  sha256(
    [...f]
      .map(([k, v]) => `${k}:${v.hash}`)
      .sort()
      .join('\n')
  )
const KIND_LABEL: Record<SensitiveChange['kind'], string> = {
  'protected-edit': '보호 직원(COO, CTO, CFO, hr) 수정',
  'employee-removal': '직원 삭제',
  'tools-expansion': '도구(Bash, 쓰기) 확대'
}

/**
 * 보호 대상 파일의 변경 감지, 검증, 민감 변경 판정, 격리, 스냅샷 복원을 맡는다.
 * 자동 복원은 없다: `restore`와 `accept`는 CEO가 카드에서 누르는 IPC 경로(`isTrustedSender` 통과)에서만 호출한다.
 */
export class IntegrityService {
  private chain: Promise<unknown> = Promise.resolve()
  private appDepth = 0

  constructor(private readonly deps: IntegrityDeps) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date()
  }

  private locked<T>(task: () => Promise<T>): Promise<T> {
    const run = this.chain.then(task, task)
    this.chain = run.catch(() => undefined)
    return run
  }

  isQuarantined(employeeId: string): Promise<boolean> {
    return this.deps.state.isQuarantined(employeeId)
  }

  quarantined(): Promise<string[]> {
    return this.deps.state.quarantined()
  }

  /** 제안 카드(T-046)가 CEO 승인을 받으면 main 코드가 변경 후 내용의 해시를 기록한다. LLM 경로에서는 호출할 수 없다. */
  approve(file: string, hash: string): Promise<void> {
    if (!isProtectedPath(file) || !/^[0-9a-f]{64}$/.test(hash))
      return Promise.reject(new Error('invalid-approval'))
    return this.deps.state.update((d) => {
      d.approvals.push({ file, hash, at: this.now().toISOString() })
      // 이미 카드를 만든 상태라도 승인 뒤에는 다시 판정해야 한다.
      d.reported = null
    })
  }

  /**
   * 앱 함수(T-035/T-045/T-040)가 파일을 쓰는 동안을 감싼다. 그 변경은 `actor`로 기록하고 경고 카드를 만들지 않는다.
   * 시작 전에 앞선 외부 변경을 먼저 정리해, 외부 변경이 앱 쓰기로 오인되지 않게 한다.
   */
  async withAppWrite<T>(actor: 'ceo-ui' | 'approved-proposal', fn: () => Promise<T>): Promise<T> {
    await this.reconcile().catch(() => undefined)
    this.appDepth++
    try {
      return await fn()
    } finally {
      this.appDepth--
      await this.reconcile({ actor }).catch(() => undefined)
    }
  }

  /** hr 전용 실행(T-059) 직전 호출: 변경을 정리하고, 정상이면 그 상태가 스냅샷이 된다. */
  snapshotBefore(): Promise<ReconcileResult> {
    return this.reconcile()
  }

  reconcile(opts: { actor?: ChangeActor; hint?: 'hr-direct' } = {}): Promise<ReconcileResult> {
    return this.locked(() => this.reconcileNow(opts))
  }

  private async plan(
    base: FileMap,
    cur: FileMap,
    opts: { actor?: ChangeActor; hint?: 'hr-direct' }
  ): Promise<Plan> {
    const changed = diffMaps(base, cur)
    const actors = new Map<string, ChangeActor>()
    const app = opts.actor !== undefined && APP_ACTORS.has(opts.actor)
    for (const f of changed) {
      const h = cur.get(f)?.hash ?? DELETED_HASH
      actors.set(
        f,
        opts.actor ??
          ((await this.deps.state.isApproved(f, h))
            ? 'approved-proposal'
            : (opts.hint ?? 'unknown'))
      )
    }
    const issues = validateAll(base, cur)
    for (const f of changed)
      if (isPolicyPath(f) && actors.get(f) !== 'approved-proposal' && !app)
        issues.push({
          code: 'policy-changed',
          file: f,
          message: '정책 파일이 앱 밖에서 바뀌었습니다.',
          severity: 'violation'
        })
    for (const f of filesWithSecrets(cur))
      issues.push({
        code: 'snapshot-secret',
        file: f,
        message: '비밀 값처럼 보이는 문자열이 있어 스냅샷을 만들지 않았습니다.',
        severity: 'violation'
      })
    for (const [f, v] of cur)
      if (v.text === null)
        issues.push({
          code: 'snapshot-oversize',
          file: f,
          message: '파일이 너무 커서 복원할 수 없습니다.',
          severity: 'info'
        })
    let sensitive: SensitiveChange[] = []
    if (!app) {
      for (const s of judgeSensitive(base, cur))
        if (!(await this.deps.state.isApproved(s.file, s.hash))) sensitive.push(s)
    }
    sensitive = sensitive.filter(
      (s, i) =>
        sensitive.findIndex(
          (x) => x.kind === s.kind && x.file === s.file && x.employeeId === s.employeeId
        ) === i
    )
    return { changed, actors, issues, sensitive }
  }

  private async reconcileNow(opts: {
    actor?: ChangeActor
    hint?: 'hr-direct'
  }): Promise<ReconcileResult> {
    const skipped: ReconcileResult = { status: 'skipped', cardIds: [], issues: [] }
    // 앱 쓰기 진행 중에는 외부 변경으로 오인하지 않도록 건너뛰고, 마지막 앱 쓰기가 끝날 때 한 번에 정리한다.
    if (this.appDepth > 0) return skipped
    const cur = await readProtectedFiles(this.deps.fs)
    const baseSnap = await this.deps.snapshots.latestBaseline()
    if (baseSnap === null) {
      // 첫 실행: 지금 상태를 기준으로 삼는다 (이전 이력이 없어 비교할 대상이 없다).
      const r = await this.deps.snapshots.save(cur, 'baseline')
      return { status: r.ok ? 'initialized' : 'flagged', cardIds: [], issues: [] }
    }
    const base = toFileMap(baseSnap)
    const changed = diffMaps(base, cur)
    const st = await this.deps.state.get()
    if (changed.length === 0) {
      if (st.reported !== null) await this.deps.state.update((d) => (d.reported = null))
      return { status: 'unchanged', cardIds: [], issues: [] }
    }
    const curHash = stateHash(cur)
    const app = opts.actor !== undefined && APP_ACTORS.has(opts.actor)
    if (st.reported !== null) {
      // 풀리지 않은 문제가 있는 동안의 앱 쓰기는 기준선을 올리지 않는다 (문제를 덮지 않는다).
      if (app) await this.deps.state.update((d) => (d.reported = curHash))
      if (app || st.reported === curHash) return { ...skipped, status: 'flagged' }
    }

    const plan = await this.plan(base, cur, opts)
    const violations = plan.issues.filter((i) => i.severity === 'violation')
    const infos = plan.issues.filter((i) => i.severity === 'info' && i.code !== 'snapshot-oversize')
    const flagged = violations.length > 0 || plan.sensitive.length > 0
    const cardIds: string[] = []

    if (flagged) {
      const ids = [
        ...new Set(plan.sensitive.flatMap((s) => (s.employeeId === null ? [] : [s.employeeId])))
      ]
      const kinds = new Map(plan.sensitive.map((s) => [s.employeeId ?? '', s.kind]))
      if (ids.length > 0)
        await this.deps.state.update((d) => {
          for (const id of ids)
            d.quarantine[id] ??= {
              since: this.now().toISOString(),
              reason: kinds.get(id) ?? 'sensitive',
              file: plan.sensitive.find((s) => s.employeeId === id)?.file ?? ''
            }
        })
      if (!app) cardIds.push(await this.flagCard(plan, violations, ids))
    }
    if (infos.length > 0 && !app)
      cardIds.push(
        await this.deps.cards.create({
          kind: 'decision',
          title: 'PM 지정이 필요한 프로젝트가 생겼습니다',
          ticketId: null,
          question: 'PM이 없는 프로젝트가 있습니다. 담당 PM을 새로 지정해야 합니다.',
          options: [{ key: 'A', label: '확인', description: '프로젝트에서 PM을 다시 지정합니다.' }],
          impact: 'PM이 지정될 때까지 해당 프로젝트는 PM 필요 상태입니다.',
          reason: '직원 배정 변경 감지(PM 줄 삭제 또는 PM 직원 퇴사)'
        })
      )

    await this.deps.audit.append(this.auditEntries(plan, base, cur, cardIds, violations))

    if (flagged) {
      await this.deps.state.update((d) => (d.reported = curHash))
      return { status: 'flagged', cardIds, issues: plan.issues }
    }
    await this.deps.snapshots.save(cur, 'baseline')
    await this.deps.state.update((d) => (d.reported = null))
    return { status: 'clean', cardIds, issues: plan.issues }
  }

  private async flagCard(plan: Plan, violations: IntegrityIssue[], ids: string[]): Promise<string> {
    const revert = plan.sensitive.length > 0 || violations.some((v) => REVERT_CODES.has(v.code))
    const lines = [
      ...plan.sensitive.map((s) => `${KIND_LABEL[s.kind]}: ${s.employeeId ?? s.file}`),
      ...violations.map((v) => `${v.message} (${v.file})`)
    ]
    const only =
      violations.every((v) => v.code === 'snapshot-secret') && plan.sensitive.length === 0
    return this.deps.cards.create({
      kind: revert ? 'revert-suggestion' : 'integrity-warning',
      title: revert
        ? '승인되지 않은 인사·설정 변경이 감지되었습니다'
        : '인사 파일 검증에 실패했습니다',
      ticketId: null,
      question: `${lines.slice(0, 6).join(' / ')} (변경 파일 ${plan.changed.length}개)`,
      options: only
        ? [
            {
              key: 'A',
              label: '확인',
              description: '비밀 값을 제거하면 다음 변경 때 스냅샷이 다시 만들어집니다.'
            }
          ]
        : [
            {
              key: 'A',
              label: '되돌리기',
              description:
                '마지막 정상 스냅샷으로 보호 대상 파일을 복원합니다 (현재 상태도 스냅샷으로 남습니다).'
            },
            {
              key: 'B',
              label: plan.sensitive.length > 0 ? '사후 승인' : '그대로 두기',
              description:
                plan.sensitive.length > 0
                  ? '변경을 승인하고 직원 격리를 해제합니다.'
                  : '직접 수정하겠습니다. 복원하지 않습니다.'
            }
          ],
      impact:
        ids.length > 0
          ? `격리된 직원(${ids.join(', ')})은 해제될 때까지 실행되지 않습니다.`
          : '자동 복원은 하지 않습니다. 확인 전까지 마지막 정상 스냅샷이 유지됩니다.',
      reason: '인사 변경 가드레일이 승인 기록 없는 변경을 감지했습니다.'
    })
  }

  private auditEntries(
    plan: Plan,
    base: FileMap,
    cur: FileMap,
    cardIds: string[],
    violations: IntegrityIssue[]
  ): HrAuditEntry[] {
    const sensitiveFiles = new Set(plan.sensitive.map((s) => s.file))
    return plan.changed.map((f) => {
      const here = plan.issues.filter((i) => i.file === f && i.code !== 'snapshot-oversize')
      const v = violations.filter((i) => i.file === f).map((i) => i.code)
      const info = here.filter((i) => i.severity === 'info').map((i) => i.code)
      let result = 'ok'
      if (v.length > 0) result = `violation:${v.join(',')}`
      else if (sensitiveFiles.has(f)) result = 'unapproved'
      else if (info.length > 0) result = `info:${info.join(',')}`
      return {
        at: this.now(),
        file: f,
        summary: summarizeDiff(base.get(f)?.text ?? null, cur.get(f)?.text ?? null),
        actor: plan.actors.get(f) ?? 'unknown',
        result,
        card: result === 'ok' ? null : (cardIds[0] ?? null),
        beforeHash: base.get(f)?.hash ?? DELETED_HASH,
        afterHash: cur.get(f)?.hash ?? DELETED_HASH
      }
    })
  }

  /** CEO가 카드에서 "되돌리기"를 눌렀을 때만 호출한다. 마지막 정상 스냅샷으로 복원하고 격리를 푼다. */
  restore(): Promise<IntegrityActionResult> {
    return this.locked(async () => {
      if (this.appDepth > 0) return { ok: false, code: 'busy', files: [] }
      const snap = await this.deps.snapshots.latestBaseline()
      if (snap === null) return { ok: false, code: 'no-baseline', files: [] }
      const unreadable = Object.entries(snap.files)
        .filter(([, t]) => t === null)
        .map(([k]) => k)
      if (unreadable.length > 0) return { ok: false, code: 'not-restorable', files: unreadable }
      const base = toFileMap(snap)
      this.appDepth++
      try {
        const cur = await readProtectedFiles(this.deps.fs)
        // 복원 전 현재 상태도 남긴다 (비밀 패턴이 있으면 저장하지 않지만 복원은 막지 않는다).
        await this.deps.snapshots.save(cur, 'pre-restore')
        const changed = diffMaps(base, cur)
        await this.deps.exclusive(async () => {
          for (const f of changed) {
            const want = snap.files[f]
            if (!isProtectedPath(f)) continue
            if (typeof want === 'string') await this.deps.fs.writeText(f, want)
            else await this.deps.fs.remove(f).catch(() => undefined)
          }
        })
        await this.deps.audit.append(
          changed.map((f) => ({
            at: this.now(),
            file: f,
            summary: summarizeDiff(cur.get(f)?.text ?? null, base.get(f)?.text ?? null),
            actor: 'ceo-ui',
            result: 'restored',
            card: null,
            beforeHash: cur.get(f)?.hash ?? DELETED_HASH,
            afterHash: base.get(f)?.hash ?? DELETED_HASH
          }))
        )
        await this.deps.state.update((d) => {
          d.quarantine = {}
          d.reported = null
        })
        return { ok: true, restored: changed.length }
      } finally {
        this.appDepth--
      }
    })
  }

  /** CEO가 "사후 승인"을 눌렀을 때만 호출한다. 현재 상태를 승인해 기준선으로 삼고 격리를 푼다. 검증 위반이 있으면 거부한다. */
  accept(): Promise<IntegrityActionResult> {
    return this.locked(async () => {
      if (this.appDepth > 0) return { ok: false, code: 'busy', files: [] }
      const snap = await this.deps.snapshots.latestBaseline()
      if (snap === null) return { ok: false, code: 'no-baseline', files: [] }
      const base = toFileMap(snap)
      const cur = await readProtectedFiles(this.deps.fs)
      const plan = await this.plan(base, cur, { actor: 'ceo-ui' })
      const bad = plan.issues.filter((i) => i.severity === 'violation')
      if (bad.length > 0)
        return { ok: false, code: 'validation-failed', files: [...new Set(bad.map((i) => i.file))] }
      const saved = await this.deps.snapshots.save(cur, 'baseline')
      if (!saved.ok) return { ok: false, code: 'validation-failed', files: saved.files }
      await this.deps.state.update((d) => {
        for (const f of plan.changed)
          d.approvals.push({
            file: f,
            hash: cur.get(f)?.hash ?? DELETED_HASH,
            at: this.now().toISOString()
          })
        d.quarantine = {}
        d.reported = null
      })
      await this.deps.audit.append(
        plan.changed.map((f) => ({
          at: this.now(),
          file: f,
          summary: summarizeDiff(base.get(f)?.text ?? null, cur.get(f)?.text ?? null),
          actor: 'ceo-ui',
          result: 'accepted',
          card: null,
          beforeHash: base.get(f)?.hash ?? DELETED_HASH,
          afterHash: cur.get(f)?.hash ?? DELETED_HASH
        }))
      )
      return { ok: true, restored: plan.changed.length }
    })
  }
}

function toFileMap(s: Snapshot): FileMap {
  return new Map(Object.entries(s.files).map(([k, text]) => [k, { text, hash: s.hashes[k] }]))
}
