import { describe, expect, it } from 'vitest'
import {
  HR_ALLOW_PATHS,
  HR_TOOLS,
  buildHrSettings,
  coveredByIntegrity,
  isHrWritablePath
} from './hr-scope'

describe('hr write scope', () => {
  const s = buildHrSettings().permissions

  it('allows exactly the four write targets and only for Edit and Write', () => {
    expect(HR_ALLOW_PATHS).toEqual([
      '.claude/agents/*.md',
      'company/org.md',
      'company/archive/**',
      'company/project.md'
    ])
    expect(s.allow.sort()).toEqual(
      HR_ALLOW_PATHS.flatMap((p) => [`Edit(${p})`, `Write(${p})`]).sort()
    )
  })

  it('gives hr no Bash and no shell-capable tool', () => {
    expect([...HR_TOOLS]).toEqual(['Read', 'Write', 'Edit', 'Grep', 'Glob'])
    expect(s.allow.some((r) => r.startsWith('Bash'))).toBe(false)
  })

  it.each([
    '.claude/agents/cto.md',
    '.claude/agents/cfo.md',
    '.claude/agents/hr.md',
    '.claude/agents/coo.md',
    'CLAUDE.md',
    '.claude/settings*',
    '.claude/rules/**',
    'company/tickets/**',
    'company/policies/**',
    'company/decisions/**',
    'company/finance/**',
    'company/audit/**',
    'company/hr-requests/**',
    'company/mission.md',
    '~/.claude/**',
    '~/.ssh/**'
  ])('denies writing %s through every edit tool', (p) => {
    for (const t of ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
      expect(s.deny).toContain(`${t}(${p})`)
  })

  it('denies reading credential files', () => {
    expect(s.deny).toEqual(
      expect.arrayContaining(['Read(~/.claude/**)', 'Read(~/.ssh/**)', 'Read(**/.env*)'])
    )
  })

  it('classifies paths the same way the allow list does', () => {
    for (const ok of [
      '.claude/agents/designer.md',
      'company/org.md',
      'company/project.md',
      'company/archive/pm.md',
      'company/archive/2026/x.md'
    ])
      expect(isHrWritablePath(ok), ok).toBe(true)
    for (const no of [
      '.claude/agents/cto.md',
      '.claude/agents/cfo.md',
      '.claude/agents/hr.md',
      '.claude/agents/coo.md',
      '.claude/agents/sub/x.md',
      '.claude/agents/x.txt',
      'company/archive',
      'company/archive/',
      'company/tickets/backlog/T-001.md',
      'company/decisions/pending/D-001.md',
      'company/policies/alpha.md',
      'company/audit/hr.md',
      'company/finance/budget.md',
      'company/hr-requests/001.md',
      'company/mission.md',
      'CLAUDE.md',
      '.claude/settings.json',
      '../outside.md',
      'company\\org.md'
    ])
      expect(isHrWritablePath(no), no).toBe(false)
  })

  it('leaves protected employees and policies to the integrity guard to avoid duplicate cards', () => {
    expect(coveredByIntegrity('.claude/agents/cto.md')).toBe(true)
    expect(coveredByIntegrity('company/policies/alpha.md')).toBe(true)
    expect(coveredByIntegrity('company/tickets/backlog/T-001.md')).toBe(false)
  })
})
