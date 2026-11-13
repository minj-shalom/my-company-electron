import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, readdir, readFile, readlink } from 'node:fs/promises'
import { isUtf8 } from 'node:buffer'
import { join } from 'node:path'

/** 회사 폴더 전체의 파일 지문. hr 실행 전후로 만들어 허용 목록 밖 변경을 찾는다. */
export interface ManifestEntry {
  /** sha256 hex. 링크는 `symlink:<대상>`, 일반 파일이 아닌 항목은 `other`. */
  hash: string
  /** 복원용 본문. 크기 상한 안의 UTF-8 파일만 담는다. */
  text: string | null
}
export interface Manifest {
  entries: Map<string, ManifestEntry>
  /** 항목 수 상한에 걸려 일부만 담았는지. 이 경우 비교는 불완전하다. */
  truncated: boolean
}

export type ChangeKind = 'added' | 'removed' | 'modified'
export interface ManifestChange {
  path: string
  kind: ChangeKind
}

export const MANIFEST_LIMITS = {
  maxEntries: 20_000,
  maxDepth: 12,
  maxTextBytes: 256 * 1024,
  maxTotalTextBytes: 8 * 1024 * 1024
} as const

/** 버전 관리 메타데이터와 의존성 폴더는 회사 문서가 아니고 크기가 커서 비교에서 뺀다. */
const SKIP_DIRS: ReadonlySet<string> = new Set(['.git', 'node_modules'])

const sha = (v: string | Buffer): string => createHash('sha256').update(v).digest('hex')

function hashStream(abs: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256')
    createReadStream(abs)
      .on('data', (c) => h.update(c))
      .on('error', reject)
      .on('end', () => resolve(h.digest('hex')))
  })
}

/** 루트 아래를 심볼릭 링크를 따라가지 않고 훑는다 (읽기만 한다). */
export async function takeManifest(root: string): Promise<Manifest> {
  const entries = new Map<string, ManifestEntry>()
  let truncated = false
  let textBytes = 0
  const visit = async (rel: string, depth: number): Promise<void> => {
    if (depth > MANIFEST_LIMITS.maxDepth) {
      truncated = true
      return
    }
    const abs = rel === '' ? root : join(root, rel)
    const names = (await readdir(abs)).sort()
    for (const name of names) {
      if (entries.size >= MANIFEST_LIMITS.maxEntries) {
        truncated = true
        return
      }
      const childRel = rel === '' ? name : `${rel}/${name}`
      const childAbs = join(root, childRel)
      const st = await lstat(childAbs).catch(() => null)
      if (st === null) continue
      if (st.isSymbolicLink()) {
        const target = await readlink(childAbs).catch(() => '')
        entries.set(childRel, { hash: `symlink:${sha(target)}`, text: null })
      } else if (st.isDirectory()) {
        if (!SKIP_DIRS.has(name)) await visit(childRel, depth + 1)
      } else if (st.isFile()) {
        let text: string | null = null
        let hash: string
        try {
          if (
            st.size <= MANIFEST_LIMITS.maxTextBytes &&
            textBytes + st.size <= MANIFEST_LIMITS.maxTotalTextBytes
          ) {
            const buf = await readFile(childAbs)
            hash = sha(buf)
            if (isUtf8(buf)) {
              text = buf.toString('utf8')
              textBytes += buf.length
            }
          } else hash = await hashStream(childAbs)
        } catch {
          // 읽는 사이에 사라진 파일은 이번 훑기에서 제외한다 (다음 비교에서 삭제로 보인다).
          continue
        }
        entries.set(childRel, { hash, text })
      } else entries.set(childRel, { hash: 'other', text: null })
    }
  }
  await visit('', 0)
  return { entries, truncated }
}

export function diffManifests(before: Manifest, after: Manifest): ManifestChange[] {
  const out: ManifestChange[] = []
  for (const [path, b] of before.entries) {
    const a = after.entries.get(path)
    if (a === undefined) out.push({ path, kind: 'removed' })
    else if (a.hash !== b.hash) out.push({ path, kind: 'modified' })
  }
  for (const path of after.entries.keys())
    if (!before.entries.has(path)) out.push({ path, kind: 'added' })
  return out.sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0))
}
