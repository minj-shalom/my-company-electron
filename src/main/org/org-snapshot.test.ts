import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CompanyContext, NoCompanyError, type LastCompanyStore } from '../company/company-context'
import { createDomainHandlers } from '../domain-ipc'
import { ProviderService } from '../providers/provider-service'
import type { WeeklyLimitsStore } from '../settings/weekly-limits-store'

const ORG = await readFile(new URL('./fixtures/real-org-with-hr.md', import.meta.url), 'utf8')

let base: string
beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'mc-snap-'))
})
afterEach(() => rm(base, { recursive: true, force: true }))

const noStore: LastCompanyStore = { load: async () => null, save: async () => undefined }
const noLimits: WeeklyLimitsStore = { load: async () => [], save: async () => undefined }

async function makeCompany(agents: Record<string, string>): Promise<string> {
  const dir = join(base, 'co')
  await mkdir(join(dir, 'company'), { recursive: true })
  await mkdir(join(dir, '.claude', 'agents'), { recursive: true })
  await writeFile(join(dir, 'CLAUDE.md'), '# c', 'utf8')
  await writeFile(join(dir, 'company', 'org.md'), ORG, 'utf8')
  for (const [id, text] of Object.entries(agents)) {
    await writeFile(join(dir, '.claude', 'agents', `${id}.md`), text, 'utf8')
  }
  return dir
}

const ALL = [
  'cto',
  'cfo',
  'hr',
  'pm',
  'developer',
  'electron-main-dev',
  'ui-dev',
  'devops',
  'web-frontend-dev',
  'reviewer-qa'
]
const agentFile = (id: string): string =>
  `---\nname: ${id}\ndescription: ${id} desc\nmodel: sonnet\ntools: Read, Grep, Bash\n---\n본문\n`

function handlers(context: CompanyContext): ReturnType<typeof createDomainHandlers> {
  return createDomainHandlers({ context, providers: new ProviderService(), limits: noLimits })
}

describe('org:get', () => {
  it('returns no-company when no company is open', async () => {
    const h = handlers(new CompanyContext({ store: noStore }))
    expect(() => new CompanyContext({ store: noStore }).requireOpenCompany()).toThrow(
      NoCompanyError
    )
    expect(await h.getOrg()).toEqual({
      ok: false,
      code: 'no-company',
      message: '열린 회사가 없습니다.'
    })
  })

  it('shows hr in the org and agent details with split tools', async () => {
    const dir = await makeCompany(Object.fromEntries(ALL.map((id) => [id, agentFile(id)])))
    const ctx = new CompanyContext({ store: noStore })
    expect((await ctx.open(dir)).ok).toBe(true)
    const r = await handlers(ctx).getOrg()
    if (!r.ok) throw new Error('expected ok')
    const hr = r.value.org.members.find((m) => m.agentId === 'hr')
    expect(hr).toMatchObject({
      title: '인사',
      department: '인사팀',
      reportsTo: 'COO',
      fileExists: true
    })
    expect(r.value.org.issues).toEqual([])
    const detail = r.value.agents.find((a) => a.id === 'hr')
    expect(detail).toEqual({
      id: 'hr',
      name: 'hr',
      description: 'hr desc',
      model: 'sonnet',
      tools: ['Read', 'Grep', 'Bash']
    })
  })

  it('accepts YAML list tools and degrades broken frontmatter without leaking paths', async () => {
    const agents = Object.fromEntries(ALL.map((id) => [id, agentFile(id)]))
    agents['hr'] = '---\nname: hr\ndescription: d\ntools:\n  - Read\n  - Edit\n---\n'
    agents['cto'] = '---\n: : [broken\n---\n'
    const dir = await makeCompany(agents)
    const ctx = new CompanyContext({ store: noStore })
    await ctx.open(dir)
    const r = await handlers(ctx).getOrg()
    if (!r.ok) throw new Error('expected ok')
    expect(r.value.agents.find((a) => a.id === 'hr')?.tools).toEqual(['Read', 'Edit'])
    expect(r.value.agents.find((a) => a.id === 'cto')).toMatchObject({ description: '', tools: [] })
    expect(JSON.stringify(r)).not.toContain(base)
  })

  it('reports missing agent files as issues, not failures', async () => {
    const dir = await makeCompany({ cto: agentFile('cto') })
    const ctx = new CompanyContext({ store: noStore })
    await ctx.open(dir)
    const r = await handlers(ctx).getOrg()
    if (!r.ok) throw new Error('expected ok')
    expect(r.value.org.issues.some((i) => i.code === 'missing-agent-file')).toBe(true)
    expect(r.value.agents.map((a) => a.id)).toEqual(['cto'])
  })
})
