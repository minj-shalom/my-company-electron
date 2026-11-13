import { EMPLOYEE_ID } from '../repository/ids'
import type { StateStore } from '../gate/state-store'

const MAX_APPROVALS = 200

export interface Approval {
  file: string
  hash: string
  at: string
}

export interface QuarantineEntry {
  since: string
  /** 격리 사유 종류 (예: `tools-expansion`). */
  reason: string
  file: string
}

export interface IntegrityStateData {
  approvals: Approval[]
  quarantine: Record<string, QuarantineEntry>
  /** 이미 카드를 만든 변경 상태의 해시. 같은 상태에서 카드를 또 만들지 않는다. */
  reported: string | null
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const EMPTY = (): IntegrityStateData => ({ approvals: [], quarantine: {}, reported: null })

function parse(raw: unknown): IntegrityStateData {
  const out = EMPTY()
  if (!isRecord(raw)) return out
  if (Array.isArray(raw.approvals))
    for (const a of raw.approvals)
      if (isRecord(a) && typeof a.file === 'string' && typeof a.hash === 'string')
        out.approvals.push({ file: a.file, hash: a.hash, at: typeof a.at === 'string' ? a.at : '' })
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
  if (typeof raw.reported === 'string') out.reported = raw.reported
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

  get(): Promise<IntegrityStateData> {
    return this.load()
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

  async isApproved(file: string, hash: string): Promise<boolean> {
    return (await this.load()).approvals.some((a) => a.file === file && a.hash === hash)
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
