import { FsGuardError, type SafeFs } from '../repository/safe-fs'
import { USAGE_DIR } from './usage-store'

const FILE = `${USAGE_DIR}/alerts.md`
const HEADER =
  '# 한도 경고 기록\n\n> 같은 주간 구간에서 같은 경고 카드를 다시 만들지 않기 위한 표시입니다.\n\n'

export type AlertLevel = 'warn' | 'exceeded'

const keyOf = (provider: string, windowStart: string, level: AlertLevel): string =>
  `- ${provider} ${windowStart} ${level}`

/** 경고 카드를 이미 만든 (제공자, 주간 구간, 단계)를 기억한다. 구간이 바뀌면 키가 달라 새로 시작된다. */
export interface UsageAlertLog {
  has(provider: string, windowStart: string, level: AlertLevel): Promise<boolean>
  mark(provider: string, windowStart: string, level: AlertLevel): Promise<void>
}

export function createUsageAlertLog(fs: SafeFs): UsageAlertLog {
  const read = async (): Promise<string> => {
    try {
      return await fs.readText(FILE)
    } catch (e) {
      if (e instanceof FsGuardError && e.kind === 'missing') return HEADER
      throw e
    }
  }
  return {
    async has(provider, windowStart, level) {
      const key = keyOf(provider, windowStart, level)
      return (await read()).split(/\r?\n/).includes(key)
    },
    async mark(provider, windowStart, level) {
      const text = await read()
      await fs.writeText(
        FILE,
        `${text.endsWith('\n') ? text : `${text}\n`}${keyOf(provider, windowStart, level)}\n`
      )
    }
  }
}
