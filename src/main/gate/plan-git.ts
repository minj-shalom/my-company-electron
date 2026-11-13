import { createHash } from 'node:crypto'
import {
  PROTECTED_MERGE_MAX_DAILY,
  isProtectedBranch,
  normalizeBranchName
} from '../../shared/policy'
import {
  GitArgError,
  SHA_RE,
  checkBranchName,
  ghPrMerge,
  ghPrView,
  gitPush,
  gitPushUrlConfig,
  gitResolveBranch,
  gitSymbolicHead
} from './git-args'
import type { GatePlan, PlanOutcome, Planner, ReviewChecker } from './gate-types'

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex')
const reject = (message: string): PlanOutcome => ({ kind: 'reject', message })
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** 도구 입력에서 허용 키만 받는다. `force` 같은 알 수 없는 키가 있으면 거부한다. */
function onlyKeys(raw: unknown, allowed: readonly string[]): Record<string, unknown> | null {
  if (!isRecord(raw)) return null
  return Object.keys(raw).every((k) => allowed.includes(k)) ? raw : null
}

export const planPush: Planner = async (input, raw) => {
  const obj = onlyKeys(raw ?? {}, ['branch'])
  if (obj === null || (obj.branch !== undefined && typeof obj.branch !== 'string'))
    return reject('입력이 올바르지 않습니다. branch만 받습니다.')
  const { dir } = input.project
  const opts = { cwd: dir, signal: input.signal }
  let name: string
  try {
    if (obj.branch === undefined || obj.branch === 'HEAD') {
      // 실제 현재 ref를 읽어 쓴다. 입력 문자열을 믿지 않는다.
      const head = await input.runner.run('git', gitSymbolicHead(), opts)
      const m = /^refs\/heads\/(.+)\n?$/.exec(head.stdout)
      if (head.code !== 0 || m === null) return reject('현재 브랜치를 확인하지 못했습니다.')
      name = checkBranchName(m[1].trim())
    } else name = checkBranchName(obj.branch)
    const rev = await input.runner.run('git', gitResolveBranch(name), opts)
    const sha = rev.stdout.trim()
    if (rev.code !== 0 || !SHA_RE.test(sha)) return reject('브랜치를 찾을 수 없습니다.')
    const { autoPushPrefixes } = input.policy.effective
    // 보호 판정은 ref 접두어를 벗긴 소문자 이름으로, 허용 접두어는 실제 이름에 그대로 맞춘다.
    // 별도 pushurl이 설정돼 있으면 푸시가 다른 곳으로 갈 수 있어 자동 푸시를 하지 않는다.
    const pushUrl = await input.runner.run('git', gitPushUrlConfig(), opts)
    const allowed =
      pushUrl.stdout.trim() === '' &&
      !isProtectedBranch(name) &&
      autoPushPrefixes.some((p) => p !== '' && name.startsWith(p))
    return {
      kind: 'plan',
      plan: {
        action: 'push',
        target: `${name}@${sha.slice(0, 7)}`,
        idemKey: sha256(`push|${input.ctx.projectId}|${name}|${sha}`),
        fallback: allowed
          ? null
          : { result: 'blocked-target', reason: '허용된 푸시 대상이 아닙니다.' },
        run: async () => {
          const r = await input.runner.run('git', gitPush(name), { ...opts, timeoutMs: 120_000 })
          return { ok: r.code === 0 }
        }
      }
    }
  } catch (e) {
    if (e instanceof GitArgError) return reject(e.message)
    throw e
  }
}

interface PrView {
  base: string
  head: string
  oid: string
  open: boolean
  draft: boolean
}

function parsePr(stdout: string): PrView | null {
  let j: unknown
  try {
    j = JSON.parse(stdout)
  } catch {
    return null
  }
  if (!isRecord(j)) return null
  const { baseRefName, headRefName, headRefOid, state, isDraft } = j
  if (
    typeof baseRefName !== 'string' ||
    typeof headRefName !== 'string' ||
    typeof headRefOid !== 'string' ||
    !SHA_RE.test(headRefOid)
  )
    return null
  return {
    base: baseRefName,
    head: headRefName,
    oid: headRefOid,
    open: state === 'OPEN',
    draft: isDraft === true
  }
}

export function createPlanMerge(review: ReviewChecker): Planner {
  return async (input, raw) => {
    const obj = onlyKeys(raw, ['pr'])
    if (obj === null || typeof obj.pr !== 'number')
      return reject('입력이 올바르지 않습니다. pr 번호만 받습니다.')
    const opts = { cwd: input.project.dir, signal: input.signal }
    try {
      const view = await input.runner.run('gh', ghPrView(obj.pr), opts)
      const pr = view.code === 0 ? parsePr(view.stdout) : null
      if (pr === null) return reject('PR을 확인하지 못했습니다.')
      if (!pr.open || pr.draft) return reject('열려 있는 일반 PR만 머지할 수 있습니다.')
      const base = checkBranchName(pr.base)
      const eff = input.policy.effective
      const protectedBase = isProtectedBranch(base)
      const listed = eff.autoMergeBranches.some(
        (b) => normalizeBranchName(b) === normalizeBranchName(base)
      )
      const targetOk = eff.usePr && listed && (!protectedBase || eff.protectedMergeEnabled)
      let fallback: GatePlan['fallback'] = null
      if (!targetOk) fallback = { result: 'blocked-target', reason: '허용된 머지 대상이 아닙니다.' }
      else if (eff.reviewStage === 'required') {
        const t = input.ctx.ticketId
        if (t === null || !(await review.passed(input.ctx.projectId, t)))
          fallback = { result: 'blocked-review', reason: 'reviewer-qa 통과 기록이 없습니다.' }
      }
      return {
        kind: 'plan',
        plan: {
          action: 'merge',
          target: `${base}<-PR#${obj.pr}@${pr.oid.slice(0, 7)}`,
          idemKey: sha256(`merge|${input.ctx.projectId}|${obj.pr}|${pr.oid}`),
          fallback,
          extraCap: protectedBase ? PROTECTED_MERGE_MAX_DAILY : undefined,
          run: async () => {
            const r = await input.runner.run('gh', ghPrMerge(obj.pr as number, pr.oid), {
              ...opts,
              timeoutMs: 120_000
            })
            return { ok: r.code === 0 }
          }
        }
      }
    } catch (e) {
      if (e instanceof GitArgError) return reject(e.message)
      throw e
    }
  }
}
