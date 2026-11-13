import type { UsageRecord } from '../../shared/usage'
import { FsGuardError, type SafeFs } from '../repository/safe-fs'
import { parseUsageFile, renderUsageFileHeader, renderUsageLine } from './usage-record'
import { inWindow } from './usage-aggregate'
import { localDay, type UsageWindow } from './usage-window'

export const USAGE_DIR = 'company/finance/usage'
const DAY_FILE = /^(\d{4}-\d{2}-\d{2})\.md$/

// 같은 회사 폴더에 대한 읽기-수정-쓰기가 겹치면 기록이 유실되므로 회사별로 한 줄로 세운다.
const queues = new Map<string, Promise<unknown>>()
export function serialFor<T>(root: string, task: () => Promise<T>): Promise<T> {
  const run = (queues.get(root) ?? Promise.resolve()).then(task)
  queues.set(
    root,
    run.catch(() => undefined)
  )
  return run
}

export interface UsageStore {
  append(record: UsageRecord): Promise<void>
  /** 구간 안의 기록을 시간순으로 돌려준다. 읽지 못하는 파일은 건너뛴다. */
  readWindow(w: UsageWindow): Promise<UsageRecord[]>
}

/**
 * 하루 한 파일(`YYYY-MM-DD.md`, 로컬 날짜)에 기록한다. 하루 단위라 파일이 SafeFs 크기 한도를 넘을 일이 없고,
 * 집계는 구간에 걸치는 파일만 읽는다. 보관 기간 제한은 두지 않는다 (자동 삭제 없음, 사람이 폴더에서 정리).
 */
export function createUsageStore(fs: SafeFs): UsageStore {
  return {
    append: (record) =>
      serialFor(fs.root, async () => {
        const path = `${USAGE_DIR}/${localDay(new Date(record.at))}.md`
        let text: string
        try {
          text = await fs.readText(path)
        } catch (e) {
          if (!(e instanceof FsGuardError && e.kind === 'missing')) throw e
          text = renderUsageFileHeader(localDay(new Date(record.at)))
        }
        await fs.writeText(
          path,
          `${text.endsWith('\n') ? text : `${text}\n`}${renderUsageLine(record)}\n`
        )
      }),
    async readWindow(w) {
      // 기록 시각(UTC)과 파일의 로컬 날짜가 어긋날 수 있어 앞뒤 하루를 여유로 읽고 시각으로 다시 거른다.
      const from = new Date(w.start.getTime() - 86_400_000)
      const lo = localDay(from)
      const hi = localDay(new Date(w.end.getTime() + 86_400_000))
      const { files } = await fs.listMarkdown(USAGE_DIR)
      const out: UsageRecord[] = []
      for (const f of files) {
        const day = DAY_FILE.exec(f)?.[1]
        if (day === undefined || day < lo || day > hi) continue
        try {
          out.push(
            ...parseUsageFile(await fs.readText(`${USAGE_DIR}/${f}`)).filter((r) => inWindow(r, w))
          )
        } catch {
          // 한 파일을 읽지 못해도 나머지 집계는 계속한다.
        }
      }
      return out.sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    }
  }
}
