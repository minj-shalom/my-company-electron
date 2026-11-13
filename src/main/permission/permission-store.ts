import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { DECISION_ID, TICKET_ID } from '../repository/ids'

const FILE = 'permission-requests.json'
const MAX_ENTRIES = 100

/** 카드가 승인되면 적용할 규칙. 카드 본문이 아니라 앱 데이터에서만 읽는다 (에이전트가 카드를 위조해도 규칙을 심지 못한다). */
export interface PermissionRequestRecord {
  rule: string
  ticketId: string | null
  /** 회사 경로. 다른 회사에서 만든 요청을 적용하지 않는다. */
  companyKey: string
  /** `rejected`는 거절된 요청의 기록이다. 같은 티켓에서 같은 거부가 다시 나도 카드를 새로 만들지 않는다. */
  state: 'open' | 'rejected'
}

export interface PermissionStore {
  put(cardId: string, rec: Omit<PermissionRequestRecord, 'state'>): Promise<void>
  /**
   * 열린 요청을 한 번만 돌려준다. 승인이면 지우고, 거절이면 `rejected`로 남긴다.
   * 없거나 이미 처리됐거나 다른 회사의 것이면 null.
   */
  take(
    cardId: string,
    companyKey: string,
    outcome: 'approved' | 'rejected'
  ): Promise<PermissionRequestRecord | null>
  /** 열린 또는 거절된 같은 요청이 있는지 (틱마다 같은 카드가 쌓이지 않게). */
  has(rule: string, ticketId: string | null, companyKey: string): Promise<boolean>
}

function parse(raw: string): Record<string, PermissionRequestRecord> {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return {}
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return {}
  const out: Record<string, PermissionRequestRecord> = {}
  for (const [id, v] of Object.entries(data)) {
    if (!DECISION_ID.test(id) || typeof v !== 'object' || v === null) continue
    const r = v as Record<string, unknown>
    if (typeof r['rule'] !== 'string' || typeof r['companyKey'] !== 'string') continue
    const ticketId = r['ticketId']
    if (ticketId !== null && !(typeof ticketId === 'string' && TICKET_ID.test(ticketId))) continue
    out[id] = {
      rule: r['rule'],
      ticketId,
      companyKey: r['companyKey'],
      state: r['state'] === 'rejected' ? 'rejected' : 'open'
    }
  }
  return out
}

/** 앱 userData에 둔다. 회사 폴더, git, 에이전트가 읽는 파일에 들어가지 않는다. */
export function createPermissionStore(userDataDir: string): PermissionStore {
  const file = join(userDataDir, FILE)
  let chain: Promise<unknown> = Promise.resolve()
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const run = chain.then(task, task)
    chain = run.catch(() => undefined)
    return run
  }
  async function read(): Promise<Record<string, PermissionRequestRecord>> {
    try {
      return parse(await readFile(file, 'utf8'))
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {}
      throw e
    }
  }
  async function write(all: Record<string, PermissionRequestRecord>): Promise<void> {
    const ids = Object.keys(all).sort((a, b) => Number(b.slice(2)) - Number(a.slice(2)))
    const kept = Object.fromEntries(ids.slice(0, MAX_ENTRIES).map((id) => [id, all[id]]))
    await mkdir(dirname(file), { recursive: true })
    const tmp = `${file}.tmp`
    await writeFile(tmp, JSON.stringify(kept), { encoding: 'utf8', mode: 0o600 })
    await rename(tmp, file)
  }
  return {
    put: (cardId, rec) =>
      serial(async () => {
        const all = await read()
        all[cardId] = { ...rec, state: 'open' }
        await write(all)
      }),
    take: (cardId, companyKey, outcome) =>
      serial(async () => {
        const all = await read()
        const rec = all[cardId]
        if (rec === undefined || rec.state !== 'open' || rec.companyKey !== companyKey) return null
        if (outcome === 'approved') delete all[cardId]
        else all[cardId] = { ...rec, state: 'rejected' }
        await write(all)
        return rec
      }),
    has: (rule, ticketId, companyKey) =>
      serial(async () =>
        Object.values(await read()).some(
          (r) => r.rule === rule && r.ticketId === ticketId && r.companyKey === companyKey
        )
      )
  }
}
