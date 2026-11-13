import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/**
 * 로컬 발행 기록 (멱등 키 기준). 상태:
 * - `in-flight`: 어댑터 호출 중이거나 중단됨. 결과를 모른다.
 * - `published`: 게시 확인됨. 같은 키는 다시 게시하지 않는다.
 * - `needs-confirm`: 타임아웃·네트워크 오류·비동기 처리 중이라 게시 여부를 모른다. 사람이 확인하기 전까지 자동 재시도 금지.
 * 확정 실패(거절·인증·한도 등)는 기록을 지워 재시도를 허용한다.
 * 키는 해시뿐이라 토큰·본문이 없다.
 */
export type PublishRecordState = 'in-flight' | 'published' | 'needs-confirm'

export interface PublishRecordStore {
  get(key: string): PublishRecordState | undefined
  /** 이미 기록이 있으면 false (동시 중복 호출 차단). */
  begin(key: string): Promise<boolean>
  set(key: string, state: PublishRecordState): Promise<void>
  clear(key: string): Promise<void>
}

const KEY = /^[0-9a-f]{64}$/
const STATES: readonly string[] = ['in-flight', 'published', 'needs-confirm']

export function createMemoryRecordStore(): PublishRecordStore {
  const m = new Map<string, PublishRecordState>()
  return {
    get: (k) => m.get(k),
    begin: async (k) => {
      if (m.has(k)) return false
      m.set(k, 'in-flight')
      return true
    },
    set: async (k, s) => void m.set(k, s),
    clear: async (k) => void m.delete(k)
  }
}

/** 파일에 저장하는 기록. 앱이 발행 중 종료돼도 `in-flight`가 남아 다음 실행에서 자동 재시도하지 않는다. */
export async function createFileRecordStore(file: string): Promise<PublishRecordStore> {
  const m = new Map<string, PublishRecordState>()
  try {
    const raw: unknown = JSON.parse(await readFile(file, 'utf8'))
    if (typeof raw === 'object' && raw !== null && !Array.isArray(raw))
      for (const [k, v] of Object.entries(raw))
        if (KEY.test(k) && typeof v === 'string' && STATES.includes(v))
          m.set(k, v as PublishRecordState)
  } catch {
    // 파일이 없거나 깨졌으면 빈 기록으로 시작한다. 기록은 마크다운 원본이 아니라 중복 방지용 보조 상태다.
  }
  const save = async (): Promise<void> => {
    await mkdir(dirname(file), { recursive: true })
    const tmp = `${file}.tmp`
    await writeFile(tmp, JSON.stringify(Object.fromEntries(m)), { mode: 0o600 })
    await rename(tmp, file)
  }
  return {
    get: (k) => m.get(k),
    begin: async (k) => {
      if (m.has(k)) return false
      m.set(k, 'in-flight')
      await save()
      return true
    },
    set: async (k, s) => {
      m.set(k, s)
      await save()
    },
    clear: async (k) => {
      m.delete(k)
      await save()
    }
  }
}
