import { mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PermissionDenial } from '../../shared/run'
import { deriveAllowRule, revalidateRule } from './permission-rule'

let root: string
let outside: string
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'mc-perm-')))
  outside = await realpath(await mkdtemp(join(tmpdir(), 'mc-perm-out-')))
  await mkdir(join(root, 'docs'), { recursive: true })
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  await rm(outside, { recursive: true, force: true })
})

const bash = (command: string | null): PermissionDenial => ({ tool: 'Bash', command, path: null })
const file = (path: string | null, tool = 'Write'): PermissionDenial => ({
  tool,
  command: null,
  path
})

describe('deriveAllowRule', () => {
  it('turns a plain command into an exact (non-wildcard) rule', async () => {
    expect(await deriveAllowRule(bash('npm test'), root)).toMatchObject({ rule: 'Bash(npm test)' })
  })

  it.each([
    'git push origin develop',
    'git -C ../x push',
    'git reset --hard',
    'gh pr merge 3',
    'gh api repos/x',
    'sudo ls',
    'rm -rf docs',
    'curl https://example.com',
    'npm test && npm run build',
    'ls | wc -l',
    'echo $(whoami)',
    'cat ~/.claude/settings.json',
    'cat company/policies/x.md',
    'cat .env',
    'echo hi > out.txt',
    'npm *',
    'export TOKEN=abc',
    'x'.repeat(301),
    '/bin/rm -rf docs',
    './rm x',
    'RM -rf docs',
    'command rm x',
    'nice rm x',
    'nice -n 5 rm x',
    'nohup rm x',
    'time rm x',
    'exec rm x',
    'builtin rm x',
    'env rm x',
    'FOO=1 rm x',
    'FOO=1 BAR=2 command nohup /usr/bin/RM x',
    'GIT push origin x',
    '/usr/bin/git push',
    'perl -e 1',
    'python3 -c 1',
    'python -c 1',
    'node -e 1',
    'node --eval 1',
    'ruby -e 1',
    'osascript x.scpt',
    'find . -exec ls {}',
    'find . -delete',
    'cat .CLAUDE',
    'cat .Claude'
  ])('refuses %s', async (cmd) => {
    expect(await deriveAllowRule(bash(cmd), root)).toBeNull()
  })

  it('refuses a Bash denial without a command and unsupported tools', async () => {
    expect(await deriveAllowRule(bash(null), root)).toBeNull()
    expect(await deriveAllowRule({ tool: 'WebFetch', command: null, path: null }, root)).toBeNull()
  })

  it('maps file tools to a relative Edit rule inside the company folder', async () => {
    expect(await deriveAllowRule(file(join(root, 'docs/a.md')), root)).toMatchObject({
      rule: 'Edit(docs/a.md)'
    })
    expect(await deriveAllowRule(file('docs/b.md', 'Edit'), root)).toMatchObject({
      rule: 'Edit(docs/b.md)'
    })
  })

  it.each([
    '../outside.md',
    '/etc/passwd',
    'docs/../../x',
    'docs/*.md',
    'company/policies/p.md',
    'company/audit/a.md',
    'company/org.md',
    '.claude/settings.local.json',
    '.claude/agents/x.md',
    '.git/config',
    '.env',
    'company/publishing/a.md',
    'Company/Org.md',
    'COMPANY/POLICIES/p.md',
    '.CLAUDE/settings.local.json',
    '.claude'
  ])('refuses file path %s', async (p) => {
    expect(await deriveAllowRule(file(p), root)).toBeNull()
  })

  it('refuses a symlink inside the folder that resolves to a protected path', async () => {
    await mkdir(join(root, 'company/policies'), { recursive: true })
    await mkdir(join(root, '.claude'), { recursive: true })
    await symlink(join(root, 'company/policies'), join(root, 'docs/p'))
    await symlink(join(root, '.claude'), join(root, 'docs/c'))
    expect(await deriveAllowRule(file('docs/p/x.md'), root)).toBeNull()
    expect(await deriveAllowRule(file('docs/c/x.md'), root)).toBeNull()
  })

  it('allows harmless wrapped commands but not interpreters', async () => {
    expect(await deriveAllowRule(bash('nice npm test'), root)).not.toBeNull()
    expect(await deriveAllowRule(bash('python3 script.py'), root)).toBeNull()
  })

  it('refuses paths that escape through a symlink', async () => {
    await symlink(outside, join(root, 'link'))
    expect(await deriveAllowRule(file('link/x.md'), root)).toBeNull()
  })
})

describe('revalidateRule', () => {
  it('accepts only rules in the shape this module produces', async () => {
    expect(await revalidateRule('Bash(npm test)', root)).not.toBeNull()
    expect(await revalidateRule('Edit(docs/a.md)', root)).not.toBeNull()
    expect(await revalidateRule('Bash(git push:*)', root)).toBeNull()
    expect(await revalidateRule('Bash(npm *)', root)).toBeNull()
    expect(await revalidateRule('Edit(company/policies/x.md)', root)).toBeNull()
    expect(await revalidateRule('Edit(/etc/passwd)', root)).toBeNull()
    expect(await revalidateRule('WebFetch(domain:x.com)', root)).toBeNull()
  })
})
