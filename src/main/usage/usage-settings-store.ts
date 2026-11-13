import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  USAGE_SETTINGS_DEFAULT,
  validateUsageSettings,
  type UsageSettings
} from '../../shared/usage'

const FILE = 'usage-settings.json'

export interface UsageSettingsStore {
  /** 파일이 없거나 손상되었으면 기본값. */
  load(): Promise<UsageSettings>
  save(s: UsageSettings): Promise<void>
}

/** 주간 한도와 마찬가지로 이 기기의 설정이라 userData에 둔다. */
export function createUsageSettingsStore(userDataDir: string): UsageSettingsStore {
  const file = join(userDataDir, FILE)
  return {
    async load() {
      try {
        const v: unknown = JSON.parse(await readFile(file, 'utf8'))
        return validateUsageSettings(v) ? pick(v) : { ...USAGE_SETTINGS_DEFAULT }
      } catch {
        return { ...USAGE_SETTINGS_DEFAULT }
      }
    },
    async save(s) {
      await mkdir(dirname(file), { recursive: true })
      const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`
      try {
        await writeFile(tmp, JSON.stringify(pick(s)), 'utf8')
        await rename(tmp, file)
      } catch (e) {
        await unlink(tmp).catch(() => undefined)
        throw e
      }
    }
  }
}

/** 알려진 필드만 복사한다 (추가 필드 저장 차단). */
export function pick(s: UsageSettings): UsageSettings {
  return {
    warnPercent: s.warnPercent,
    krwPerUsd: s.krwPerUsd,
    resetWeekday: s.resetWeekday,
    resetHour: s.resetHour
  }
}
