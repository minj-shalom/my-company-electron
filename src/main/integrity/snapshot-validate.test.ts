import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { HrAudit, formatHrAuditLine, summarizeDiff, HR_AUDIT_FILE } from './hr-audit'
import {
  diffMaps,
  filesWithSecrets,
  isProtectedPath,
  readProtectedFiles,
  sha256,
  type FileMap
} from './protected-files'
import { SnapshotStore, MAX_SNAPSHOTS } from './snapshot-store'
import { cleanup, company, put } from './test-kit'
import { validateAll, validateAgentFile, validateOrg, validateProjectFile } from './validators'

afterEach(cleanup)

const mk = (over: Record<string, string>): FileMap =>
  new Map(Object.entries(over).map(([k, v]) => [k, { text: v, hash: sha256(v) }]))

async function load(c: Awaited<ReturnType<typeof company>>): Promise<FileMap> {
  return readProtectedFiles(c.fs)
}

describe('protected file set', () => {
  it('limits paths to the protected set', () => {
    expect(isProtectedPath('.claude/agents/hr.md')).toBe(true)
    expect(isProtectedPath('company/org.md')).toBe(true)
    expect(isProtectedPath('company/project.md')).toBe(true)
    expect(isProtectedPath('company/archive/employees/x.md')).toBe(true)
    expect(isProtectedPath('company/policies/alpha.md')).toBe(true)
    expect(isProtectedPath('company/tickets/in-progress/T-1.md')).toBe(false)
    expect(isProtectedPath('company/archive/../../x.md')).toBe(false)
    expect(isProtectedPath('.claude/settings.json')).toBe(false)
  })

  it('reads agents, org, project, archive and policies', async () => {
    const c = await company()
    await put(c.dir, 'company/archive/employees/old.md', '# old\n')
    await put(c.dir, 'company/policies/alpha.md', '# p\n')
    const files = await load(c)
    expect([...files.keys()]).toEqual(
      expect.arrayContaining([
        'company/org.md',
        'company/project.md',
        '.claude/agents/hr.md',
        'company/archive/employees/old.md',
        'company/policies/alpha.md'
      ])
    )
    expect(diffMaps(files, files)).toEqual([])
  })

  it('detects secret patterns without returning contents', () => {
    const files = mk({
      'a.md': 'x',
      'b.md': `token = "${'A'.repeat(30)}"`,
      'c.md': `ghp_${'a'.repeat(30)}`
    })
    expect(filesWithSecrets(files)).toEqual(['b.md', 'c.md'])
    expect(filesWithSecrets(mk({ 'ok.md': '직원 목록과 token 설명' }))).toEqual([])
  })
})

describe('snapshot store', () => {
  const dirs: string[] = []
  afterEach(async () => {
    for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
  })
  const dir = async (): Promise<string> => {
    const d = await mkdtemp(join(tmpdir(), 'mc-snap-'))
    dirs.push(d)
    return d
  }

  it('round-trips a baseline and keeps at most 20', async () => {
    const d = await dir()
    const store = new SnapshotStore(d, () => new Date(), filesWithSecrets)
    for (let i = 0; i < MAX_SNAPSHOTS + 5; i++) {
      const r = await store.save(mk({ 'company/org.md': `v${i}` }), 'baseline')
      expect(r.ok).toBe(true)
    }
    expect(await store.count()).toBe(MAX_SNAPSHOTS)
    const latest = await store.latestBaseline()
    expect(latest?.files['company/org.md']).toBe(`v${MAX_SNAPSHOTS + 4}`)
  })

  it('drops snapshots older than 14 days but keeps the latest baseline', async () => {
    const d = await dir()
    let now = new Date('2026-11-01T00:00:00Z')
    const store = new SnapshotStore(d, () => now)
    await store.save(mk({ 'company/org.md': 'old' }), 'baseline')
    now = new Date('2026-11-20T00:00:00Z')
    await store.save(mk({ 'company/org.md': 'newer' }), 'pre-restore')
    expect(await store.count()).toBe(2)
    expect((await store.latestBaseline())?.files['company/org.md']).toBe('old')
    now = new Date('2026-11-21T00:00:00Z')
    await store.save(mk({ 'company/org.md': 'b' }), 'baseline')
    expect(await store.count()).toBe(2)
  })

  it('aborts on secret patterns and writes nothing', async () => {
    const d = await dir()
    const store = new SnapshotStore(d, () => new Date(), filesWithSecrets)
    const r = await store.save(mk({ '.claude/agents/x.md': `ghp_${'b'.repeat(30)}` }), 'baseline')
    expect(r).toEqual({ ok: false, reason: 'secret', files: ['.claude/agents/x.md'] })
    expect(await readdir(d)).toEqual([])
  })

  it('rejects tampered snapshots (paths outside the protected set)', async () => {
    const d = await dir()
    const store = new SnapshotStore(d)
    await writeFile(
      join(d, '00000000000001-000-aaaaaa.json'),
      JSON.stringify({
        at: new Date().toISOString(),
        kind: 'baseline',
        files: { '../../evil.md': 'x' },
        hashes: { '../../evil.md': 'h' }
      })
    )
    expect(await store.latestBaseline()).toBeNull()
  })
})

describe('org validation', () => {
  it('passes the real org and flags new issues only', async () => {
    const c = await company()
    const base = await load(c)
    expect(validateAll(base, base)).toEqual([])
    expect(validateOrg(null, base)).toEqual([])
  })

  it('flags chart/table mismatch, duplicate employee, cycle and missing agent file', async () => {
    const c = await company()
    const base = await load(c)
    const org = base.get('company/org.md')!.text!
    const chart = org.replace('인사팀 (hr)', '인사팀 (hr, ghost)')
    const m1 = validateOrg(
      base,
      new Map(base).set('company/org.md', { text: chart, hash: sha256(chart) })
    )
    expect(m1.map((i) => i.code)).toContain('chart-mismatch')

    const dup = org.replace(/\| PM\s+\| `pm`/, '| PM2 | `developer`')
    const m2 = validateOrg(
      base,
      new Map(base).set('company/org.md', { text: dup, hash: sha256(dup) })
    )
    expect(m2.map((i) => i.code)).toContain('duplicate-employee')

    const cyc = org.replace(/(\| COO[^\n]*?\| 경영\s+\| )CEO/, '$1CTO')
    const m3 = validateOrg(
      base,
      new Map(base).set('company/org.md', { text: cyc, hash: sha256(cyc) })
    )
    expect(m3.map((i) => i.code)).toContain('cycle')

    const gone = new Map(base)
    gone.delete('.claude/agents/pm.md')
    expect(validateOrg(base, gone).map((i) => i.code)).toContain('missing-agent-file')
  })
})

describe('agent file validation', () => {
  const ok = '---\nname: x\ndescription: d\nmodel: sonnet\ntools: Read, Grep\n---\n\nbody\n'
  const run = (t: string): string[] =>
    validateAgentFile('.claude/agents/x.md', t).map((i) => i.code)

  it('accepts a normal file', () => expect(run(ok)).toEqual([]))
  it('rejects name != file name', () =>
    expect(run(ok.replace('name: x', 'name: y'))).toEqual(['agent-name-mismatch']))
  it('rejects unknown model and bad tools', () => {
    expect(run(ok.replace('sonnet', 'gpt'))).toEqual(['agent-model'])
    expect(run(ok.replace('Read, Grep', 'Re ad!'))).toEqual(['agent-tools'])
  })
  it('rejects broken frontmatter', () => {
    expect(run('no frontmatter')).toEqual(['agent-unparsable'])
    expect(run('---\n: : :\n  - [\n---\nx')).toEqual(['agent-unparsable'])
  })
  it('rejects oversize body', () => {
    expect(run(`${ok}${'a'.repeat(1_000_001)}`)).toEqual(['agent-body-size'])
  })
})

describe('project.md diff validation', () => {
  const change = async (
    edit: (t: string) => string,
    extra?: (m: FileMap) => void
  ): Promise<ReturnType<typeof validateProjectFile>> => {
    const c = await company()
    const base = await load(c)
    const after = new Map(base)
    const t = edit(base.get('company/project.md')!.text!)
    after.set('company/project.md', { text: t, hash: sha256(t) })
    extra?.(after)
    return validateProjectFile(base, after)
  }
  const codes = (r: Awaited<ReturnType<typeof change>>): string[] => r.map((i) => i.code)

  it('allows 직원 and valid PM line changes', async () => {
    expect(await change((t) => t.replace('직원: developer, ui-dev', '직원: developer'))).toEqual([])
    expect(await change((t) => t.replace('- PM: pm\n', '- PM: pm\n'))).toEqual([])
    expect(
      await change((t) =>
        t.replace('경로: ../beta\n', '경로: ../beta\n- PM: pm\n- 직원: reviewer-qa\n')
      )
    ).toEqual([])
  })

  it('flags changes outside assignment lines', async () => {
    expect(codes(await change((t) => t.replace('경로: ../alpha', '경로: ../evil')))).toEqual([
      'project-line-changed'
    ])
    expect(codes(await change((t) => t.replace('Alpha', 'Gamma')))).toEqual([
      'project-line-changed'
    ])
    expect(codes(await change((t) => t.replace('유형: content', '유형: other')))).toEqual([
      'project-line-changed'
    ])
    expect(
      codes(await change((t) => `${t}\n## 프로젝트: Gamma\n- id: gamma\n- 경로: ../g\n`))
    ).toEqual(['project-line-changed'])
    expect(codes(await change((t) => t.split('## 프로젝트: Beta')[0]))).toEqual([
      'project-line-changed'
    ])
    expect(codes(await change((t) => `${t}\n메모 추가\n`))).toEqual(['project-line-changed'])
  })

  it('flags unknown assignee, non-PM, unknown PM, duplicate PM and bad format', async () => {
    expect(codes(await change((t) => t.replace('ui-dev', 'ghost')))).toEqual(['assignee-unknown'])
    expect(codes(await change((t) => t.replace('PM: pm', 'PM: developer')))).toEqual(['pm-not-pm'])
    expect(codes(await change((t) => t.replace('PM: pm', 'PM: ghost')))).toEqual(['pm-unknown'])
    expect(codes(await change((t) => t.replace('- PM: pm\n', '- PM: pm\n- PM: pm\n')))).toEqual([
      'pm-duplicate'
    ])
    expect(codes(await change((t) => t.replace('PM: pm', 'PM: Not Valid')))).toEqual(['pm-format'])
  })

  it('treats PM removal and PM employee retirement as a state change, not a violation', async () => {
    const del = await change((t) => t.replace('- PM: pm\n', ''))
    expect(del.map((i) => [i.code, i.severity])).toEqual([['pm-needed', 'info']])
    const org = await change(
      (t) => t,
      (m) => {
        m.delete('.claude/agents/pm.md')
        const o = m
          .get('company/org.md')!
          .text!.split('\n')
          .filter((l) => !l.includes('`pm`'))
          .join('\n')
        m.set('company/org.md', { text: o, hash: sha256(o) })
        m.set('company/project.md', { text: PM_KEEP, hash: sha256(PM_KEEP) })
      }
    )
    expect(org.map((i) => [i.code, i.severity])).toEqual([['pm-needed', 'info']])
  })
})

const PM_KEEP = `# 프로젝트

## 프로젝트: Alpha
- id: alpha
- 유형: development
- 경로: ../alpha
- PM: pm
- 직원: developer, ui-dev

## 프로젝트: Beta
- id: beta
- 유형: content
- 경로: ../beta
`

describe('hr audit', () => {
  it('formats a single-line fixed format and appends only', async () => {
    const e = {
      at: new Date('2026-11-13T01:00:00.000Z'),
      file: 'company/org.md',
      summary: '+1 -0 ~2',
      actor: 'unknown' as const,
      result: 'violation:chart-mismatch',
      card: 'D-050',
      beforeHash: sha256('a'),
      afterHash: 'deleted'
    }
    expect(formatHrAuditLine(e)).toBe(
      `| 2026-11-13T01:00:00.000Z | company/org.md | +1 -0 ~2 | unknown | violation:chart-mismatch | D-050 | ${sha256('a').slice(0, 12)} | deleted |`
    )
    const c = await company()
    const audit = new HrAudit({ fs: c.fs, exclusive: (t) => t() })
    await audit.append([e])
    await audit.append([{ ...e, file: 'a\nb|c' }])
    const text = await c.fs.readText(HR_AUDIT_FILE)
    expect(text.split('\n').filter((l) => l.startsWith('| 2026')).length).toBe(2)
    expect(text).toContain('| a b/c |')
  })

  it('summarizes line diffs', () => {
    expect(summarizeDiff('a\nb\nc', 'a\nb\nd\ne')).toBe('+1 -0 ~1')
    expect(summarizeDiff('a', null)).toBe('+0 -1 ~0')
    expect(summarizeDiff(null, 'a')).toBe('+1 -0 ~0')
  })
})
