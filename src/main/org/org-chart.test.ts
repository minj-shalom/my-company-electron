import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createFileGateCards } from '../gate/gate-cards'
import { createMemoryStateStore } from '../gate/state-store'
import { HrAudit } from '../integrity/hr-audit'
import { IntegrityService } from '../integrity/integrity-service'
import { IntegrityStateStore } from '../integrity/integrity-state'
import { SnapshotStore } from '../integrity/snapshot-store'
import { filesWithSecrets } from '../integrity/protected-files'
import { cleanup, company } from '../integrity/test-kit'
import { addDepartment, addMember, loadOrg, removeMember, updateMember } from './org-store'
import { chartMismatches, syncChartText, type ChartChange } from './org-chart'
import { parseOrgDocument } from './parse-org-doc'

const tmp: string[] = []
afterEach(async () => {
  await cleanup()
  for (const d of tmp.splice(0)) await rm(d, { recursive: true, force: true })
})

async function setup(): Promise<{
  c: Awaited<ReturnType<typeof company>>
  svc: IntegrityService
  agent: (id: string) => Promise<void>
}> {
  const c = await company()
  const snapDir = await mkdtemp(join(tmpdir(), 'mc-ochart-'))
  tmp.push(snapDir)
  const exclusive = <T>(t: () => Promise<T>): Promise<T> => c.repo.runExclusive(t)
  const svc = new IntegrityService({
    fs: c.fs,
    exclusive,
    snapshots: new SnapshotStore(snapDir, () => new Date(), filesWithSecrets),
    state: new IntegrityStateStore(createMemoryStateStore()),
    audit: new HrAudit({ fs: c.fs, exclusive }),
    cards: createFileGateCards({ fs: c.fs, exclusive })
  })
  await svc.reconcile()
  const agent = async (id: string): Promise<void> => {
    const base = await c.fs.readText('.claude/agents/developer.md')
    await c.fs.writeText(`.claude/agents/${id}.md`, base.replace(/^name: .*$/m, `name: ${id}`))
  }
  return { c, svc, agent }
}

const chartOf = (text: string): string => /## 조직도\n+```\n([\s\S]*?)```/.exec(text)?.[1] ?? ''

describe('org-store keeps the org chart block in sync (T-064)', () => {
  it('passes the T-052 integrity check after hire, update, department add and removal', async () => {
    const { c, svc, agent } = await setup()
    const org = (): Promise<string> => c.fs.readText('company/org.md')
    const reconcile = async (): Promise<void> => {
      const r = await svc.reconcile()
      expect(r.issues).toEqual([])
      expect(['unchanged', 'clean']).toContain(r.status)
    }

    await svc.withAppWrite('ceo-ui', async () => {
      await agent('qa-bot')
      const hired = await addMember(c.fs, {
        title: 'QA 봇',
        agentId: 'qa-bot',
        department: '개발팀',
        reportsTo: 'CTO',
        role: '자동 검수'
      })
      expect(hired.ok).toBe(true)
    })
    await reconcile()
    expect(chartOf(await org())).toContain('devops, reviewer-qa, qa-bot)')

    await svc.withAppWrite('ceo-ui', async () => {
      const moved = await updateMember(c.fs, 'qa-bot', { department: '기획팀' })
      expect(moved.ok).toBe(true)
    })
    await reconcile()
    const moved = chartOf(await org())
    expect(moved).toContain('기획팀 (pm, qa-bot)')
    expect(moved).not.toContain('reviewer-qa, qa-bot')

    await svc.withAppWrite('ceo-ui', async () => {
      await agent('ops-lead')
      const dept = await addDepartment(c.fs, {
        name: '운영팀',
        lead: {
          title: '운영 리드',
          agentId: 'ops-lead',
          reportsTo: 'COO',
          role: '운영'
        }
      })
      expect(dept.ok).toBe(true)
    })
    await reconcile()
    const withDept = chartOf(await org())
    expect(withDept).toContain('├─ 기획팀 (pm, qa-bot)')
    expect(withDept).toContain('└─ 운영팀 (ops-lead)')

    await svc.withAppWrite('ceo-ui', async () => {
      expect((await removeMember(c.fs, 'ops-lead')).ok).toBe(true)
      expect((await removeMember(c.fs, 'qa-bot')).ok).toBe(true)
      expect((await removeMember(c.fs, 'hr')).ok).toBe(true)
    })
    await reconcile()
    const after = chartOf(await org())
    expect(after).not.toContain('운영팀')
    expect(after).not.toContain('qa-bot')
    expect(after).not.toContain('인사팀')
    expect(after).toContain('기획팀 (pm)')
    const model = await loadOrg(c.fs)
    expect(chartMismatches(model)).toEqual([])
    expect(model.issues).toEqual([])
  })

  it('rejects hiring when the chart parent cannot be found, leaving org.md untouched', async () => {
    const { c, agent } = await setup()
    await agent('x-bot')
    const before = await c.fs.readText('company/org.md')
    const text = before.replace('└─ COO (메인 세션)', '└─ Chief (메인 세션)')
    await c.fs.writeText('company/org.md', text)
    const r = await addMember(c.fs, {
      title: '신규',
      agentId: 'x-bot',
      department: '신설팀',
      reportsTo: 'COO',
      role: '역할'
    })
    expect(r.ok).toBe(false)
    expect(await c.fs.readText('company/org.md')).toBe(text)
  })

  it('does not touch a document without a chart block', async () => {
    const { c, agent } = await setup()
    await agent('y-bot')
    const text = (await c.fs.readText('company/org.md')).replace(/## 조직도\n+```[\s\S]*?```\n/, '')
    await c.fs.writeText('company/org.md', text)
    const r = await addMember(c.fs, {
      title: '신규',
      agentId: 'y-bot',
      department: '개발팀',
      reportsTo: 'CTO',
      role: '역할'
    })
    expect(r.ok).toBe(true)
    expect(await c.fs.readText('company/org.md')).not.toContain('y-bot`\n```')
  })
})

describe('syncChartText', () => {
  const doc = `# 조직도
메모 한 줄

## 조직도
\`\`\`
CEO (사용자)
 └─ COO (메인 세션)
     ├─ CTO ── 개발팀 (a-dev,b-dev)
     │   └─ 직접 쓴 메모
     └─ CFO
\`\`\`
`
  const run = (change: ChartChange, text = doc): string => {
    const r = syncChartText(text, change)
    if (!r.ok) throw new Error('rejected')
    return r.text
  }

  it('preserves hand-written lines, comma style and CRLF', () => {
    const crlf = doc.replace(/\n/g, '\r\n')
    const out = run(
      { kind: 'add', agentId: 'c-dev', department: '개발팀', reportsTo: 'CTO', reportsToId: 'cto' },
      crlf
    )
    expect(out).toBe(crlf.replace('(a-dev,b-dev)', '(a-dev,b-dev,c-dev)'))
  })

  it('adds a new department as the last child and fixes the connectors', () => {
    const out = run({
      kind: 'add',
      agentId: 'ops',
      department: '운영팀',
      reportsTo: 'COO',
      reportsToId: null
    })
    expect(out).toContain('     ├─ CFO\n     └─ 운영팀 (ops)\n')
    expect(out).toContain('     │   └─ 직접 쓴 메모')
    expect(parseOrgDocument(out, new Set()).chart.map((x) => x.label)).toContain('운영팀')
  })

  it('restores the last-child connector when the last department line is removed', () => {
    const added = run({
      kind: 'add',
      agentId: 'ops',
      department: '운영팀',
      reportsTo: 'COO',
      reportsToId: null
    })
    const out = run({ kind: 'remove', agentId: 'ops', title: '운영 리드', memberTitles: [] }, added)
    expect(out).toBe(doc)
  })

  it('falls back to the line that lists the reports-to member', () => {
    const out = run({
      kind: 'add',
      agentId: 'ops',
      department: '운영팀',
      reportsTo: 'PM',
      reportsToId: 'a-dev'
    })
    expect(out).toContain('     │   ├─ 직접 쓴 메모\n     │   └─ 운영팀 (ops)\n')
  })

  it('refuses to delete a titled line that has children or details', () => {
    const r = syncChartText(doc, {
      kind: 'remove',
      agentId: 'cto',
      title: 'CTO',
      memberTitles: []
    })
    expect(r.ok).toBe(false)
  })

  it('removes a bare title line', () => {
    const out = run({ kind: 'remove', agentId: 'cfo', title: 'CFO', memberTitles: [] })
    expect(out).not.toContain('CFO')
  })
})
