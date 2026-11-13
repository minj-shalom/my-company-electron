import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { devNull, tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  GLOBAL_CONFIG,
  gitPushUrlConfig,
  GitArgError,
  assertSafeArgs,
  checkBranchName,
  ghPrMerge,
  ghPrView,
  gitPush,
  gitResolveBranch,
  gitSymbolicHead
} from './git-args'

const G0 = [
  '-c',
  `core.hooksPath=${devNull}`,
  '-c',
  'protocol.ext.allow=never',
  '-c',
  'core.fsmonitor=false'
]
const G = [...G0, '-c', 'core.sshCommand=ssh', '-c', 'push.default=nothing']

describe('real git accepts the fixed config prefix', () => {
  it('runs read-only commands in a temp repo (no push)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mc-git-args-'))
    try {
      const run = (args: string[]): ReturnType<typeof spawnSync> =>
        spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
      expect(run(['init', '-q', '-b', 'feature/x']).status).toBe(0)
      run(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'i'])
      expect(GLOBAL_CONFIG.filter((a) => a === '-c')).toHaveLength(5)
      const head = run(gitSymbolicHead())
      expect(head.status).toBe(0)
      expect(String(head.stdout).trim()).toBe('refs/heads/feature/x')
      const rev = run(gitResolveBranch('feature/x'))
      expect(rev.status).toBe(0)
      expect(String(rev.stdout).trim()).toMatch(/^[0-9a-f]{40}$/)
      // pushurl가 없으면 종료 코드 1과 빈 출력이다 (오류가 아니라 "없음").
      expect(String(run(gitPushUrlConfig()).stdout).trim()).toBe('')
      expect(run([...GLOBAL_CONFIG, 'rev-parse', 'HEAD']).status).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('git config hardening', () => {
  it('pins ssh command and allows only the read-only pushurl lookup', () => {
    expect(gitPush('feature/x').join(' ')).toContain('core.sshCommand=ssh')
    assertSafeArgs('git', gitPushUrlConfig())
    expect(() => assertSafeArgs('git', [...G, 'config', 'remote.origin.pushurl', 'evil'])).toThrow()
    expect(() =>
      assertSafeArgs('git', [...G, 'config', '--local', '--get-all', 'core.sshCommand'])
    ).toThrow()
  })
})

describe('git args', () => {
  it('builds only the safe forms and they pass the final assertion', () => {
    assertSafeArgs('git', gitPush('feature/x'))
    assertSafeArgs('git', gitResolveBranch('feature/x'))
    assertSafeArgs('git', gitSymbolicHead())
    assertSafeArgs('gh', ghPrView(3))
    assertSafeArgs('gh', ghPrMerge(3, 'b'.repeat(40)))
  })

  it.each([
    ['--force'],
    ['-f'],
    ['--force-with-lease'],
    ['--force-with-lease=main:abc'],
    ['--delete'],
    ['-d'],
    ['--mirror'],
    ['--no-verify'],
    ['+refs/heads/x:refs/heads/x'],
    [':refs/heads/x'],
    ['refs/heads/x:refs/heads/y']
  ])('rejects dangerous push argument %s', (a) => {
    expect(() => assertSafeArgs('git', [...G, 'push', 'origin', a])).toThrow(GitArgError)
    expect(() =>
      assertSafeArgs('git', [...G, 'push', 'origin', 'refs/heads/x:refs/heads/x', a])
    ).toThrow(GitArgError)
  })

  it.each([
    ['reset'],
    ['rebase'],
    ['filter-branch'],
    ['commit'],
    ['reflog'],
    ['config'],
    ['remote']
  ])('rejects history-rewriting or config subcommand %s', (sub) => {
    expect(() => assertSafeArgs('git', [...G, sub, '--hard'])).toThrow(GitArgError)
  })

  it('rejects missing or altered global config and push to another remote', () => {
    expect(() => assertSafeArgs('git', ['push', 'origin', 'refs/heads/x:refs/heads/x'])).toThrow()
    expect(() =>
      assertSafeArgs('git', [...G, 'push', 'evil', 'refs/heads/x:refs/heads/x'])
    ).toThrow()
    expect(() => assertSafeArgs('git', ['-c', 'core.sshCommand=evil', ...G, 'push'])).toThrow()
  })

  it('rejects gh admin/auto/squash flags and other gh commands', () => {
    expect(() => assertSafeArgs('gh', ['pr', 'merge', '1', '--admin'])).toThrow()
    expect(() => assertSafeArgs('gh', ['pr', 'merge', '1', '--delete-branch'])).toThrow()
    expect(() => assertSafeArgs('gh', ['api', 'x'])).toThrow()
    expect(() => assertSafeArgs('gh', ['pr', 'close', '1'])).toThrow()
  })

  it('validates names, numbers, and hashes', () => {
    for (const b of [
      '',
      '-x',
      'a..b',
      'a//b',
      'x/',
      'x.lock',
      'refs/heads/m',
      'origin/m',
      'a b',
      'a:b',
      'a/.b'
    ])
      expect(() => checkBranchName(b)).toThrow()
    expect(checkBranchName('feature/T-053')).toBe('feature/T-053')
    expect(() => ghPrView(0)).toThrow()
    expect(() => ghPrView(1.5)).toThrow()
    expect(() => ghPrMerge(1, 'zz')).toThrow()
  })
})
