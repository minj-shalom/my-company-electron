import { createHash } from 'node:crypto'
import { lstat, readFile, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'

const MAX_DRAFT_BYTES = 1024 * 1024
export const DRAFT_PATH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}\.md$/

export interface DraftReader {
  /** 프로젝트 폴더의 산출물 폴더 안 초안을 읽어 해시를 돌려준다. 없거나 밖이면 null. */
  read(projectDir: string, outputDir: string, rel: string): Promise<{ hash: string } | null>
}

export function checkDraftPath(rel: string): boolean {
  return DRAFT_PATH.test(rel) && !rel.includes('..') && !rel.includes('//')
}

const inside = (root: string, p: string): boolean => {
  const r = relative(root, p)
  return r !== '' && !r.startsWith('..') && !isAbsolute(r)
}

/** 심볼릭 링크로 산출물 폴더 밖을 가리키는 초안은 읽지 않는다 (실제 경로가 산출물 폴더 안일 때만). */
export const fsDraftReader: DraftReader = {
  async read(projectDir, outputDir, rel) {
    if (!checkDraftPath(rel) || outputDir.includes('..') || isAbsolute(outputDir)) return null
    try {
      const root = await realpath(join(projectDir, outputDir))
      if (!inside(await realpath(projectDir), root)) return null
      const abs = await realpath(join(root, rel))
      if (!inside(root, abs)) return null
      const st = await lstat(abs)
      if (!st.isFile() || st.size > MAX_DRAFT_BYTES) return null
      return {
        hash: createHash('sha256')
          .update(await readFile(abs))
          .digest('hex')
      }
    } catch {
      return null
    }
  }
}
