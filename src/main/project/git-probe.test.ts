import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readHeadBranch, spawnGit } from './git-probe'

describe('git env', () => {
  it('ignores the system gitconfig', async () => {
    const r = await spawnGit(['config', '--show-scope', '--list'], tmpdir(), 3000)
    if (r.kind === 'done') expect(r.stdout).not.toMatch(/^system\s/m)
  })
})

describe('readHeadBranch', () => {
  it('reads a branch, rejects detached HEAD, symlinked .git and missing .git', async () => {
    const d = await mkdtemp(join(tmpdir(), 'head-'))
    try {
      await mkdir(join(d, '.git'))
      await writeFile(join(d, '.git', 'HEAD'), 'ref: refs/heads/main\n')
      expect(await readHeadBranch(d)).toBe('main')
      await writeFile(join(d, '.git', 'HEAD'), 'abc123\n')
      expect(await readHeadBranch(d)).toBeNull()
      const e = await mkdtemp(join(tmpdir(), 'head-'))
      await mkdir(join(e, 'real'))
      await writeFile(join(e, 'real', 'HEAD'), 'ref: refs/heads/main\n')
      await symlink(join(e, 'real'), join(e, '.git'))
      expect(await readHeadBranch(e)).toBeNull()
      await rm(e, { recursive: true, force: true })
      expect(await readHeadBranch(join(d, 'none'))).toBeNull()
    } finally {
      await rm(d, { recursive: true, force: true })
    }
  })
})
