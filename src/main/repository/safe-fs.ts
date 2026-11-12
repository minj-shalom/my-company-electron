import { lstat, mkdir, open, readFile, readdir, realpath, rename, unlink } from 'node:fs/promises'
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
  private constructor(readonly root: string) {}

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

  /** 일반 파일만 읽는다. 크기 제한 초과, 디렉터리, 특수 파일은 거부한다. */
  async readText(rel: string): Promise<string> {
    const abs = await this.resolve(rel)
    let st
    try {
      st = await lstat(abs)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT')
        throw new FsGuardError('missing', '파일이 없습니다.')
      throw e
    }
    if (!st.isFile()) throw new FsGuardError('not-file', '일반 파일이 아닙니다.')
    if (st.size > MAX_FILE_BYTES) throw new FsGuardError('too-large', '파일이 너무 큽니다.')
    return readFile(abs, 'utf8')
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

  /**
   * 임시 파일에 쓴 뒤 rename으로 교체한다 (쓰다 만 파일을 남기지 않는다).
   * `overwrite: false`면 이미 있을 때 exists 오류.
   */
  async writeText(rel: string, content: string, overwrite = true): Promise<void> {
    const abs = await this.resolve(rel)
    if (!overwrite && (await this.exists(rel))) throw new FsGuardError('exists', '이미 있습니다.')
    await mkdir(dirname(abs), { recursive: true })
    // mkdir 이후 상위 구간이 링크로 바뀌지 않았는지 다시 확인한다.
    await this.resolve(rel)
    const tmp = `${abs}.${randomBytes(6).toString('hex')}.tmp`
    const fh = await open(tmp, 'wx')
    try {
      await fh.writeFile(content, 'utf8')
    } finally {
      await fh.close()
    }
    try {
      await rename(tmp, abs)
    } catch (e) {
      await unlink(tmp).catch(() => undefined)
      throw e
    }
  }

  async remove(rel: string): Promise<void> {
    const abs = await this.resolve(rel)
    if (!(await lstat(abs)).isFile()) throw new FsGuardError('not-file', '일반 파일이 아닙니다.')
    await unlink(abs)
  }
}

/** 상대 경로 조립용 (항상 `/` 구분자; SafeFs가 분해한다). */
export function relPath(...parts: string[]): string {
  return parts.join('/').split(sep).join('/')
}
