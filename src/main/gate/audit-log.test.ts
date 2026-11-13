import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { makeCompany, type TestCompany } from '../employee/test-company'
import { AuditLog, formatAuditLine, sanitizeCell, auditPath, type AuditEntry } from './audit-log'

const dirs: TestCompany[] = []
afterEach(async () => {
  for (const c of dirs.splice(0)) await rm(c.dir, { recursive: true, force: true })
})

const entry = (over: Partial<AuditEntry> = {}): AuditEntry => ({
  at: new Date('2026-11-13T01:00:00.000Z'),
  action: 'push',
  target: 'feature/x@abc1234',
  result: 'executed',
  employee: 'developer',
  ticket: 'T-053',
  mode: 'auto',
  count: '1/3',
  ...over
})

describe('audit line', () => {
  it('has a fixed single-line format', () => {
    expect(formatAuditLine(entry())).toBe(
      '| 2026-11-13T01:00:00.000Z | push | feature/x@abc1234 | executed | developer | T-053 | 자동 | 1/3 |'
    )
  })

  it('strips table breakers, URL queries, userinfo and token-like strings', () => {
    const bad = 'a|b\nhttps://u:p@host/x?token=SECRET123 ghp_abcdefghijklmnop sk-abcdefghijkl'
    const line = formatAuditLine(entry({ target: bad }))
    expect(line.split('\n')).toHaveLength(1)
    for (const s of ['SECRET123', 'u:p@', 'ghp_abcdef', 'sk-abcdef']) expect(line).not.toContain(s)
    expect(sanitizeCell('x'.repeat(500))).toHaveLength(160)
  })
})

describe('AuditLog', () => {
  it('appends lines, rotates big files, and summarizes by period', async () => {
    const c = await makeCompany()
    dirs.push(c)
    const log = new AuditLog({ fs: c.fs, exclusive: (t) => c.repo.runExclusive(t) })
    await log.append('my-company', entry())
    await log.append(
      'my-company',
      entry({ result: 'failed', at: new Date('2026-11-13T02:00:00.000Z') })
    )
    await log.append(
      'my-company',
      entry({ action: 'merge', result: 'blocked-limit', count: '2/2' })
    )
    await log.append('my-company', entry({ at: new Date('2026-11-01T00:00:00.000Z') }))
    const text = await readFile(join(c.dir, auditPath('my-company')), 'utf8')
    expect(text.match(/^\| 2026/gm)).toHaveLength(4)
    const s = await log.summary(
      new Date('2026-11-13T00:00:00.000Z'),
      new Date('2026-11-14T00:00:00.000Z')
    )
    expect(s.projects).toHaveLength(1)
    const p = s.projects[0]
    expect(p.counts.push.executed).toBe(1)
    expect(p.counts.push.failed).toBe(1)
    expect(p.counts.merge['blocked-limit']).toBe(1)
    expect(p.failures.map((f) => f.result)).toEqual(['failed', 'blocked-limit'])
    const empty = await log.summary(new Date('2025-01-01'), new Date('2025-01-02'))
    expect(empty.projects).toEqual([])
  })

  it('rejects invalid project ids', async () => {
    const c = await makeCompany()
    dirs.push(c)
    const log = new AuditLog({ fs: c.fs, exclusive: (t) => c.repo.runExclusive(t) })
    await expect(log.append('../x', entry())).rejects.toThrow()
  })

  it('canWrite creates the header when missing and preserves existing content', async () => {
    const c = await makeCompany()
    dirs.push(c)
    const log = new AuditLog({ fs: c.fs, exclusive: (t) => c.repo.runExclusive(t) })
    expect(await log.canWrite('my-company')).toBe(true)
    const file = join(c.dir, auditPath('my-company'))
    const head = await readFile(file, 'utf8')
    expect(head).toContain('# 자동 실행 감사 기록: my-company')
    await log.append('my-company', entry())
    const before = await readFile(file, 'utf8')
    expect(await log.canWrite('my-company')).toBe(true)
    expect(await readFile(file, 'utf8')).toBe(before)
    expect(await log.canWrite('../x')).toBe(false)
  })
})
