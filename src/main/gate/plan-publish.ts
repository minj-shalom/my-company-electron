import { createHash } from 'node:crypto'
import { checkDraftPath, type DraftReader } from './draft-reader'
import type { GatePlan, PlanOutcome, Planner } from './gate-types'
import type { Publisher } from './publisher'

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex')
const reject = (message: string): PlanOutcome => ({ kind: 'reject', message })

export interface PlanPublishDeps {
  /** 어댑터 id -> 구현. T-054가 채운다. 비어 있으면 모든 발행은 카드로 대체된다. */
  publishers: ReadonlyMap<string, Publisher>
  drafts: DraftReader
}

export function createPlanPublish(deps: PlanPublishDeps): Planner {
  return async (input, raw) => {
    const keys =
      typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? Object.keys(raw) : null
    const draft = (raw as { draft?: unknown } | null)?.draft
    if (keys === null || keys.some((k) => k !== 'draft') || typeof draft !== 'string')
      return reject('입력이 올바르지 않습니다. draft 경로만 받습니다.')
    if (!checkDraftPath(draft)) return reject('초안 경로가 올바르지 않습니다.')

    const found = await deps.drafts.read(input.project.dir, input.policy.values.outputDir, draft)
    if (found === null) return reject('초안을 찾을 수 없습니다.')
    const adapterId = input.policy.values.publishAdapter
    // 정책이 가리키는 어댑터만 쓴다. 수동(`manual`)이거나 연결된 어댑터가 없으면 자동 발행하지 않는다.
    const publisher = adapterId === 'manual' ? undefined : deps.publishers.get(adapterId)
    const fallback: GatePlan['fallback'] =
      publisher === undefined
        ? { result: 'blocked-target', reason: '연결된 발행 어댑터가 없습니다.' }
        : null
    const idemKey = sha256(`publish|${input.ctx.projectId}|${adapterId}|${found.hash}`)
    return {
      kind: 'plan',
      plan: {
        action: 'publish',
        target: `${draft}@${found.hash.slice(0, 7)}`,
        idemKey,
        fallback,
        run: async () => {
          if (publisher === undefined) return { ok: false }
          const r = await publisher.publish(
            {
              projectId: input.ctx.projectId,
              adapterId,
              draftPath: draft,
              draftHash: found.hash,
              idempotencyKey: idemKey
            },
            input.signal
          )
          return { ok: r.ok }
        }
      }
    }
  }
}
