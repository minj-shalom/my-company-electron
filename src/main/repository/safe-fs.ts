import { constants } from 'node:fs'
import { link, lstat, mkdir, open, readdir, realpath, rename, unlink } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'

export const MAX_FILE_BYTES = 1024 * 1024

export class FsGuardError extends Error {
  constructor(
    readonly kind: 'escape' | 'symlink' | 'too-large' | 'not-file' | 'exists' | 'missing',
    message: string
  ) {
    super(message)
  }
}

/**
 * 회사 폴더 루트에 묶인 파일 접근기. 모든 경로는 루트 기준 상대 경로로만 받고,
 * 각 구간이 심볼릭 링크가 아닌지 lstat으로 확인한 뒤 접근한다 (경로 탈출, 링크 우회 차단).
 */
export class SafeFs {
  private readonly writeObservers = new Set<(rel: string, content: string | null) => void>()

  private constructor(readonly root: string) {}

  /** 이 SafeFs로 성공한 쓰기·삭제를 알린다 (삭제는 content가 null). 변경 감지가 앱이 직접 쓴 파일을 구분하는 데 쓴다. */
  observeWrites(cb: (rel: string, content: string | null) => void): () => void {
    this.writeObservers.add(cb)
    return () => this.writeObservers.delete(cb)
  }

  private notify(rel: string, content: string | null): void {
    for (const cb of this.writeObservers) cb(rel, content)
  }

  static async open(companyDir: string): Promise<SafeFs> {
    if (!isAbsolute(companyDir)) throw new FsGuardError('escape', '절대 경로여야 합니다.')
    return new SafeFs(await realpath(companyDir))
  }

  /** 상대 경로를 검증해 절대 경로로 바꾼다. 존재하는 구간은 모두 심볼릭 링크가 아니어야 한다. */
  private async resolve(rel: string): Promise<string> {
    if (rel.includes('\0') || isAbsolute(rel))
      throw new FsGuardError('escape', '잘못된 경로입니다.')
    const parts = rel.split(/[\\/]/).filter((p) => p !== '' && p !== '.')
    if (parts.includes('..')) throw new FsGuardError('escape', '잘못된 경로입니다.')
    let cur = this.root
    for (const part of parts) {
      cur = join(cur, part)
      try {
        if ((await lstat(cur)).isSymbolicLink())
          throw new FsGuardError('symlink', '심볼릭 링크는 허용하지 않습니다.')
      } catch (e) {
        if (e instanceof FsGuardError) throw e
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue
        throw e
      }
    }
    const rl = relative(this.root, cur)
    if (rl.startsWith('..') || isAbsolute(rl))
      throw new FsGuardError('escape', '잘못된 경로입니다.')
    return cur
  }

  async exists(rel: string): Promise<boolean> {
    try {
      await lstat(await this.resolve(rel))
      return true
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw e
    }
  }

  /**
   * 일반 파일만 읽는다. O_NOFOLLOW로 열고 열린 핸들(fh.stat)로 종류와 크기를 확인해
   * lstat과 open 사이의 바꿔치기(TOCTOU)를 막는다.
   */
  async readText(rel: string): Promise<string> {
    const abs = await this.resolve(rel)
    let fh
    try {
      fh = await open(abs, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (code === 'ENOENT') throw new FsGuardError('missing', '파일이 없습니다.')
      if (code === 'ELOOP') throw new FsGuardError('symlink', '심볼릭 링크는 허용하지 않습니다.')
      throw e
    }
    try {
      const st = await fh.stat()
      if (!st.isFile()) throw new FsGuardError('not-file', '일반 파일이 아닙니다.')
      if (st.size > MAX_FILE_BYTES) throw new FsGuardError('too-large', '파일이 너무 큽니다.')
      return await fh.readFile('utf8')
    } finally {
      await fh.close()
    }
  }

  /** 일반 파일의 수정 시각(ms). 없거나 일반 파일이 아니면 null. 링크는 따라가지 않는다. */
  async mtimeMs(rel: string): Promise<number | null> {
    try {
      const st = await lstat(await this.resolve(rel))
      return st.isFile() ? st.mtimeMs : null
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw e
    }
  }

  /** `.md` 일반 파일 이름만 돌려준다. 심볼릭 링크 등은 `skipped`로 따로 알린다. 디렉터리가 없으면 빈 결과. */
  async listMarkdown(relDir: string): Promise<{ files: string[]; skipped: string[] }> {
    const abs = await this.resolve(relDir)
    let entries
    try {
      entries = await readdir(abs, { withFileTypes: true })
    } catch (e) {
      if (
        (e as NodeJS.ErrnoException).code === 'ENOENT' ||
        (e as NodeJS.ErrnoException).code === 'ENOTDIR'
      )
        return { files: [], skipped: [] }
      throw e
    }
    const files: string[] = []
    const skipped: string[] = []
    for (const ent of entries) {
      if (!ent.name.endsWith('.md')) continue
      if (ent.isFile()) files.push(ent.name)
      else skipped.push(ent.name)
    }
    files.sort()
    return { files, skipped }
  }

  /** 하위 디렉터리 이름만 돌려준다 (심볼릭 링크 제외). 없으면 빈 목록. */
  async listDirs(relDir: string): Promise<string[]> {
    const abs = await this.resolve(relDir)
    try {
      const entries = await readdir(abs, { withFileTypes: true })
      return entries
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort()
    } catch (e) {
      if (
        (e as NodeJS.ErrnoException).code === 'ENOENT' ||
        (e as NodeJS.ErrnoException).code === 'ENOTDIR'
      )
        return []
      throw e
    }
  }

  /**
   * 임시 파일에 쓴 뒤 교체한다 (쓰다 만 파일을 남기지 않는다).
   * `overwrite: false`는 hard link(EEXIST)로 원자적 no-clobber를 보장한다 (CLI 에이전트와 동시 쓰기 대비).
   */
  async writeText(rel: string, content: string, overwrite = true): Promise<void> {
    const abs = await this.resolve(rel)
    await mkdir(dirname(abs), { recursive: true })
    // mkdir 이후 상위 구간이 링크로 바뀌지 않았는지 다시 확인한다.
    await this.resolve(rel)
    const tmp = `${abs}.${randomBytes(6).toString('hex')}.tmp`
    try {
      const fh = await open(tmp, 'wx')
      try {
        await fh.writeFile(content, 'utf8')
      } finally {
        await fh.close()
      }
      if (overwrite) {
        await rename(tmp, abs)
      } else {
        try {
          await link(tmp, abs)
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === 'EEXIST')
            throw new FsGuardError('exists', '이미 있습니다.')
          throw e
        }
      }
      this.notify(rel, content)
    } finally {
      // rename 성공 시 tmp는 이미 없다. 그 외 모든 경로에서 잔여물을 정리한다.
      await unlink(tmp).catch(() => undefined)
    }
  }

  async remove(rel: string): Promise<void> {
    const abs = await this.resolve(rel)
    if (!(await lstat(abs)).isFile()) throw new FsGuardError('not-file', '일반 파일이 아닙니다.')
    await unlink(abs)
    this.notify(rel, null)
  }
}

/** 상대 경로 조립용 (항상 `/` 구분자; SafeFs가 분해한다). */
export function relPath(...parts: string[]): string {
  return parts.join('/').split(sep).join('/')
}
