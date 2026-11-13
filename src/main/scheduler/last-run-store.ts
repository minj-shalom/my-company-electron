import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { LastRunStore } from './scheduler'

const FILE = 'scheduler-state.json'
const MAX_ENTRIES = 50

/** 회사 경로별 마지막 틱 시각. 회사 폴더가 아니라 앱 userData에 둔다 (git에 상태가 섞이지 않게). */
export function createLastRunStore(userDataDir: string): LastRunStore {
  const file = join(userDataDir, FILE)
  async function readAll(): Promise<Record<string, number>> {
    let raw: string
    try {
      raw = await readFile(file, 'utf8')
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {}
      throw e
    }
    try {
      const data: unknown = JSON.parse(raw)
      if (typeof data !== 'object' || data === null || Array.isArray(data)) return {}
      const out: Record<string, number> = {}
      for (const [k, v] of Object.entries(data)) {
        if (typeof v === 'number' && Number.isFinite(v) && v >= 0) out[k] = v
      }
      return out
    } catch {
      return {}
    }
  }
  return {
    async load(key) {
      return (await readAll())[key] ?? null
    },
    async save(key, at) {
      const all = await readAll()
      all[key] = at
      const entries = Object.entries(all)
        .sort((a, b) => b[1] - a[1])
        .slice(0, MAX_ENTRIES)
      await mkdir(dirname(file), { recursive: true })
      const tmp = `${file}.tmp`
      await writeFile(tmp, JSON.stringify(Object.fromEntries(entries)), 'utf8')
      await rename(tmp, file)
    }
  }
}
