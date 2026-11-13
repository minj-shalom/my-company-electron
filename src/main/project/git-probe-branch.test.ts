import { describe, expect, it } from 'vitest'
import {
  detectDefaultBranch,
  FALLBACK_DEFAULT_BRANCH,
  type GitOutcome,
  type GitRunner
} from './git-probe'

const NOWHERE = '/nonexistent-t062-dir'
const runner =
  (show: GitOutcome, sym: GitOutcome): GitRunner =>
  async (args) =>
    args[0] === 'show-ref' ? show : sym
const done = (code: number, stdout = ''): GitOutcome => ({ kind: 'done', code, stdout })

describe('detectDefaultBranch', () => {
  it('uses develop when it exists', async () => {
    expect(await detectDefaultBranch(runner(done(0), done(0, 'x\n')), NOWHERE)).toBe('develop')
  })
  it('uses the current branch otherwise', async () => {
    expect(await detectDefaultBranch(runner(done(1), done(0, 'trunk\n')), NOWHERE)).toBe('trunk')
  })
  it('falls back when git fails, times out, or HEAD is detached', async () => {
    const fail: GitOutcome = { kind: 'unavailable' }
    const timeout: GitOutcome = { kind: 'timeout' }
    for (const r of [
      runner(fail, fail),
      runner(timeout, timeout),
      runner(done(1), done(128)), // detached HEAD: symbolic-ref fails
      runner(done(1), done(0, 'bad name\n'))
    ])
      expect(await detectDefaultBranch(r, NOWHERE)).toBe(FALLBACK_DEFAULT_BRANCH)
  })
})
