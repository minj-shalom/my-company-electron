import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  PROVIDER_CLI_IDS,
  validateWeeklyLimitAmount,
  type ProviderCliId,
  type WeeklyLimit
} from '../../shared/provider'

const FILE = 'weekly-limits.json'

/** 입력을 검증해 정규화한 목록을 돌려준다. 하나라도 잘못되면 null (부분 저장하지 않는다). */
export function parseWeeklyLimits(input: unknown): WeeklyLimit[] | null {
  if (typeof input !== 'object' || input === null) return null
  const limits = (input as { limits?: unknown }).limits
  if (!Array.isArray(limits) || limits.length > PROVIDER_CLI_IDS.length) return null
  const seen = new Set<ProviderCliId>()
  const out: WeeklyLimit[] = []
  for (const item of limits) {
    if (typeof item !== 'object' || item === null) return null
    const { provider, amount, unit } = item as Record<string, unknown>
    if (!PROVIDER_CLI_IDS.includes(provider as ProviderCliId)) return null
    const id = provider as ProviderCliId
    if (seen.has(id) || unit !== 'usd' || !validateWeeklyLimitAmount(amount)) return null
    seen.add(id)
    out.push({ provider: id, amount, unit })
  }
  return out
}

export interface WeeklyLimitsStore {
  load(): Promise<WeeklyLimit[]>
  save(limits: WeeklyLimit[]): Promise<void>
}

/** 앱 userData에 둔다 (회사 폴더가 아니라 이 기기의 설정). 인증 정보는 담지 않는다. */
export function createWeeklyLimitsStore(userDataDir: string): WeeklyLimitsStore {
  const file = join(userDataDir, FILE)
  return {
    async load() {
      let raw: string
      try {
        raw = await readFile(file, 'utf8')
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []
        throw e
      }
      try {
        // 손상된 파일은 "저장된 값 없음"으로 본다.
        return parseWeeklyLimits(JSON.parse(raw)) ?? []
      } catch {
        return []
      }
    },
    async save(limits) {
      await mkdir(dirname(file), { recursive: true })
      const tmp = `${file}.tmp`
      await writeFile(tmp, JSON.stringify({ limits }), 'utf8')
      await rename(tmp, file)
    }
  }
}
