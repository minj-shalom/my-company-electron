import { devNull } from 'node:os'
import { describe, expect, it } from 'vitest'
import {
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
