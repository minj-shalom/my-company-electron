import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const FILE = 'visit-state.json'
const MAX_NOTIFIED = 200
const MAX_COMPANIES = 50

export interface CompanyVisitState {
  /** 마지막 방문 시각(epoch ms). 없으면 첫 방문. */
  lastVisitAt: number | null
  /** 이미 알림을 보낸 pending 카드 id. 같은 카드로 다시 알리지 않는다. */
  notified: string[]
}

export interface VisitStore {
  load(companyTag: string): Promise<CompanyVisitState>
  save(companyTag: string, state: CompanyVisitState): Promise<void>
  /** 직렬화 큐 안에서 현재 값을 읽어 fn으로 바꾸고 저장한다. 동시 갱신이 서로의 필드를 덮어쓰지 않는다. */
  updateCompany(
    companyTag: string,
    fn: (current: CompanyVisitState) => CompanyVisitState
  ): Promise<void>
  loadNotifyEnabled(): Promise<boolean>
  saveNotifyEnabled(enabled: boolean): Promise<void>
}

interface Raw {
  notifyEnabled: boolean
  companies: Record<string, CompanyVisitState>
}

function parse(text: string): Raw {
  const out: Raw = { notifyEnabled: true, companies: {} }
  try {
    const data: unknown = JSON.parse(text)
    if (typeof data !== 'object' || data === null) return out
    const d = data as { notifyEnabled?: unknown; companies?: unknown }
    if (typeof d.notifyEnabled === 'boolean') out.notifyEnabled = d.notifyEnabled
    if (typeof d.companies === 'object' && d.companies !== null) {
      for (const [k, v] of Object.entries(d.companies as Record<string, unknown>)) {
        if (typeof v !== 'object' || v === null) continue
        const { lastVisitAt, notified } = v as { lastVisitAt?: unknown; notified?: unknown }
        out.companies[k] = {
          lastVisitAt:
            typeof lastVisitAt === 'number' && Number.isFinite(lastVisitAt) && lastVisitAt >= 0
              ? lastVisitAt
              : null,
          notified: Array.isArray(notified)
            ? notified.filter((n): n is string => typeof n === 'string').slice(-MAX_NOTIFIED)
            : []
        }
      }
    }
  } catch {
    // 손상된 파일은 기본값(첫 방문, 알림 켜짐)으로 본다.
  }
  return out
}

/** 방문 상태는 회사 폴더가 아니라 이 기기의 userData에 둔다 (git에 섞이지 않고 에이전트가 쓸 수 없다). */
export function createVisitStore(userDataDir: string): VisitStore {
  const file = join(userDataDir, FILE)
  let queue: Promise<unknown> = Promise.resolve()
  const read = async (): Promise<Raw> => {
    try {
      return parse(await readFile(file, 'utf8'))
    } catch {
      return parse('')
    }
  }
  const write = async (raw: Raw): Promise<void> => {
    await mkdir(userDataDir, { recursive: true })
    const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`
    try {
      await writeFile(tmp, JSON.stringify(raw), 'utf8')
      await rename(tmp, file)
    } catch (e) {
      await unlink(tmp).catch(() => undefined)
      throw e
    }
  }
  // 읽고-고치고-쓰기를 직렬화해 알림 점검과 방문 기록이 서로의 값을 덮어쓰지 않게 한다.
  const update = (fn: (raw: Raw) => void): Promise<void> => {
    const run = queue.then(async () => {
      const raw = await read()
      fn(raw)
      await write(raw)
    })
    queue = run.catch(() => undefined)
    return run
  }
  return {
    async load(tag) {
      await queue
      return (await read()).companies[tag] ?? { lastVisitAt: null, notified: [] }
    },
    save: (tag, state) =>
      update((raw) => {
        raw.companies[tag] = {
          lastVisitAt: state.lastVisitAt,
          notified: state.notified.slice(-MAX_NOTIFIED)
        }
        const keys = Object.keys(raw.companies)
        for (const k of keys.slice(0, Math.max(0, keys.length - MAX_COMPANIES)))
          delete raw.companies[k]
      }),
    updateCompany: (tag, fn) =>
      update((raw) => {
        const next = fn(raw.companies[tag] ?? { lastVisitAt: null, notified: [] })
        raw.companies[tag] = {
          lastVisitAt: next.lastVisitAt,
          notified: next.notified.slice(-MAX_NOTIFIED)
        }
      }),
    async loadNotifyEnabled() {
      await queue
      return (await read()).notifyEnabled
    },
    saveNotifyEnabled: (enabled) =>
      update((raw) => {
        raw.notifyEnabled = enabled
      })
  }
}
