import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { isThemePreference, THEME_DEFAULT, type ThemePreference } from '../../shared/theme'

const FILE = 'theme.json'

export interface ThemeStore {
  /** 파일이 없거나 손상되었거나 허용 목록 밖이면 기본값(system). */
  load(): Promise<ThemePreference>
  save(theme: ThemePreference): Promise<void>
}

/** 회사 폴더가 아니라 이 기기의 앱 전역 설정이라 userData에 둔다. */
export function createThemeStore(userDataDir: string): ThemeStore {
  const file = join(userDataDir, FILE)
  return {
    async load() {
      try {
        const v = (JSON.parse(await readFile(file, 'utf8')) as { theme?: unknown } | null)?.theme
        return isThemePreference(v) ? v : THEME_DEFAULT
      } catch {
        return THEME_DEFAULT
      }
    },
    async save(theme) {
      await mkdir(dirname(file), { recursive: true })
      const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`
      try {
        await writeFile(tmp, JSON.stringify({ theme }), 'utf8')
        await rename(tmp, file)
      } catch (e) {
        await unlink(tmp).catch(() => undefined)
        throw e
      }
    }
  }
}
