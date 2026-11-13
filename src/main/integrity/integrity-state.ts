import { EMPLOYEE_ID } from '../repository/ids'
import type { StateStore } from '../gate/state-store'

const MAX_APPROVALS = 200

export interface Approval {
  file: string
  /** 변경 전 해시 (삭제 승인은 변경 후가 `deleted`). 이 (전 -> 후) 쌍에만 유효하다. */
  before: string
  hash: string
  at: string
}

export const APPROVAL_TTL_MS = 7 * 24 * 3600 * 1000

export interface QuarantineEntry {
  since: string
  /** 격리 사유 종류 (예: `tools-expansion`). */
  reason: string
  file: string
}

export interface IntegrityStateData {
  approvals: Approval[]
  quarantine: Record<string, QuarantineEntry>
  /** 이미 카드·감사 기록을 남긴 파일의 변경 후 해시. 같은 상태에서 카드와 감사 줄을 또 만들지 않는다. */
  reported: Record<string, string>
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const EMPTY = (): IntegrityStateData => ({ approvals: [], quarantine: {}, reported: {} })

function parse(raw: unknown): IntegrityStateData {
  const out = EMPTY()
  if (!isRecord(raw)) return out
  if (Array.isArray(raw.approvals))
    for (const a of raw.approvals)
      if (
        isRecord(a) &&
        typeof a.file === 'string' &&
        typeof a.hash === 'string' &&
        typeof a.before === 'string'
      )
        out.approvals.push({
          file: a.file,
          before: a.before,
          hash: a.hash,
          at: typeof a.at === 'string' ? a.at : ''
        })
  if (isRecord(raw.quarantine))
    for (const [id, e] of Object.entries(raw.quarantine))
      if (
        EMPLOYEE_ID.test(id) &&
        isRecord(e) &&
        typeof e.file === 'string' &&
        typeof e.reason === 'string'
      )
        out.quarantine[id] = {
          file: e.file,
          reason: e.reason,
          since: typeof e.since === 'string' ? e.since : ''
        }
  if (isRecord(raw.reported))
    for (const [f, h] of Object.entries(raw.reported))
      if (typeof h === 'string' && f !== '__proto__') out.reported[f] = h
  return out
}

/**
 * 승인 레코드와 직원 격리 상태. userData에 저장해 회사 폴더 밖에 둔다 (에이전트가 읽거나 쓸 수 없다).
 * 상태를 읽을 수 없으면 격리 조회는 "격리됨"으로 답한다 (안전한 쪽).
 */
export class IntegrityStateStore {
  private data: IntegrityStateData | null = null
  private failed = false
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly store: StateStore) {}

  private async load(): Promise<IntegrityStateData> {
    if (this.data !== null) return this.data
    try {
      this.data = parse(await this.store.load())
      this.failed = false
      return this.data
    } catch {
      this.failed = true
      return EMPTY()
    }
  }

  /** 상태를 읽을 수 없으면 던진다 (호출자는 안전한 쪽으로 멈춘다). */
  async get(): Promise<IntegrityStateData> {
    const d = await this.load()
    if (this.failed) throw new Error('state-unreadable')
    return d
  }

  /** 읽기-수정-쓰기를 한 줄로 세운다. 저장이 실패하면 메모리 상태는 되돌린다. */
  update(fn: (d: IntegrityStateData) => void): Promise<void> {
    const run = this.queue.then(async () => {
      const cur = await this.load()
      if (this.failed) throw new Error('state-unreadable')
      const next = structuredClone(cur)
      fn(next)
      next.approvals = next.approvals.slice(-MAX_APPROVALS)
      await this.store.save(next)
      this.data = next
    })
    this.queue = run.catch(() => undefined)
    return run
  }

  /** (파일, 변경 전 -> 변경 후) 쌍의 승인이 있고 만료되지 않았는지. */
  async isApproved(file: string, before: string, hash: string, now: Date): Promise<boolean> {
    const d = await this.get()
    return d.approvals.some(
      (a) =>
        a.file === file &&
        a.before === before &&
        a.hash === hash &&
        now.getTime() - Date.parse(a.at) < APPROVAL_TTL_MS
    )
  }

  /** T-016 같은 실행 경로가 쓰는 조회. 상태를 읽을 수 없으면 true. */
  async isQuarantined(employeeId: string): Promise<boolean> {
    const d = await this.load()
    return this.failed || Object.hasOwn(d.quarantine, employeeId)
  }

  async quarantined(): Promise<string[]> {
    return Object.keys((await this.load()).quarantine).sort()
  }
}
