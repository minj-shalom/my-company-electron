import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** 게이트 상태(일일 카운트, 멱등 키, 킬 스위치) 저장소. 앱 userData의 JSON이며 회사 폴더에 두지 않아 에이전트가 쓸 수 없다. */
export interface StateStore {
  load(): Promise<unknown | null>
  save(value: unknown): Promise<void>
}

export function createJsonStateStore(file: string): StateStore {
  return {
    async load() {
      try {
        return JSON.parse(await readFile(file, 'utf8')) as unknown
      } catch (e) {
        // 없을 때만 빈 상태다. 깨진 파일은 예외로 올려, 카운트가 초기화된 채 상한 없이 실행되는 일을 막는다.
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw e
      }
    },
    async save(value) {
      await mkdir(dirname(file), { recursive: true })
      const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`
      try {
        await writeFile(tmp, JSON.stringify(value), { encoding: 'utf8', mode: 0o600 })
        await rename(tmp, file)
      } catch (e) {
        await unlink(tmp).catch(() => undefined)
        throw e
      }
    }
  }
}

export function createMemoryStateStore(
  initial: unknown | null = null
): StateStore & { value: unknown } {
  const s = { value: initial as unknown }
  return {
    get value() {
      return s.value
    },
    load: async () => s.value,
    save: async (v) => {
      s.value = JSON.parse(JSON.stringify(v)) as unknown
    }
  } as StateStore & { value: unknown }
}
