import { constants } from 'node:fs'
import { lstat, open, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { isAbsolute, join } from 'node:path'
import { DRAFT_PATH, MAX_DRAFT_BYTES } from '../../shared/publication'

/** 프로젝트 폴더의 산출물 폴더를 읽기 전용으로 열람한다. 쓰기 함수는 없다. */
export class OutputPathError extends Error {}

const MAX_DEPTH = 4
const MAX_LISTED = 200

/** 상대 경로 한 개를 구간으로 나눈다. 빈 구간, `.`, `..`, 절대 경로, NUL, 역슬래시는 거부한다. */
function segments(rel: string): string[] {
  if (rel.includes('\0') || rel.includes('\\') || isAbsolute(rel) || rel.startsWith('/'))
    throw new OutputPathError('invalid-path')
  const parts = rel.split('/')
  if (parts.some((p) => p === '' || p === '.' || p === '..'))
    throw new OutputPathError('invalid-path')
  return parts
}

/** 프로젝트 폴더 아래 각 구간이 심볼릭 링크가 아닌 디렉터리인지 확인하고 절대 경로를 돌려준다. */
async function resolveDir(projectDir: string, outputDir: string): Promise<string> {
  let cur = projectDir
  for (const part of segments(outputDir)) {
    cur = join(cur, part)
    const st = await lstat(cur).catch(() => null)
    if (st === null) throw new OutputPathError('missing')
    if (st.isSymbolicLink() || !st.isDirectory()) throw new OutputPathError('invalid-path')
  }
  return cur
}

export interface DraftFile {
  path: string
  hash: string
  size: number
  text: string
}

/** 산출물 폴더 기준 상대 경로의 초안을 읽는다. 링크, 1MB 초과, 일반 파일이 아닌 것은 거부한다. */
export async function readDraft(
  projectDir: string,
  outputDir: string,
  rel: string
): Promise<DraftFile> {
  if (!DRAFT_PATH.test(rel)) throw new OutputPathError('invalid-path')
  const parts = segments(rel)
  let cur = await resolveDir(projectDir, outputDir)
  for (const part of parts.slice(0, -1)) {
    cur = join(cur, part)
    const st = await lstat(cur).catch(() => null)
    if (st === null) throw new OutputPathError('missing')
    if (st.isSymbolicLink() || !st.isDirectory()) throw new OutputPathError('invalid-path')
  }
  const abs = join(cur, parts[parts.length - 1])
  const lst = await lstat(abs).catch(() => null)
  if (lst === null) throw new OutputPathError('missing')
  if (lst.isSymbolicLink() || !lst.isFile()) throw new OutputPathError('invalid-path')
  // lstat과 open 사이에 링크로 바뀌어도 O_NOFOLLOW와 열린 핸들 검사로 막는다.
  let fh
  try {
    fh = await open(abs, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  } catch {
    throw new OutputPathError('invalid-path')
  }
  try {
    const st = await fh.stat()
    if (!st.isFile()) throw new OutputPathError('invalid-path')
    if (st.size > MAX_DRAFT_BYTES) throw new OutputPathError('too-large')
    const buf = await fh.readFile()
    if (buf.length > MAX_DRAFT_BYTES) throw new OutputPathError('too-large')
    return {
      path: rel,
      hash: createHash('sha256').update(buf).digest('hex'),
      size: buf.length,
      text: buf.toString('utf8')
    }
  } finally {
    await fh.close()
  }
}

/** 산출물 폴더 안의 `.md` 초안 상대 경로 목록 (링크와 규칙에 맞지 않는 이름은 건너뛴다). 폴더가 없으면 빈 목록. */
export async function listDrafts(projectDir: string, outputDir: string): Promise<string[]> {
  let root: string
  try {
    root = await resolveDir(projectDir, outputDir)
  } catch (e) {
    if (e instanceof OutputPathError && e.message === 'missing') return []
    throw e
  }
  const out: string[] = []
  const walk = async (abs: string, rel: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH || out.length >= MAX_LISTED) return
    const names = (await readdir(abs)).sort()
    for (const name of names) {
      if (out.length >= MAX_LISTED) return
      const r = rel === '' ? name : `${rel}/${name}`
      const st = await lstat(join(abs, name)).catch(() => null)
      if (st === null || st.isSymbolicLink()) continue
      if (st.isDirectory()) await walk(join(abs, name), r, depth + 1)
      else if (st.isFile() && DRAFT_PATH.test(r)) out.push(r)
    }
  }
  await walk(root, '', 0)
  return out
}
