import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CompanyContext } from '../company/company-context'
import { createDomainHandlers } from '../domain-ipc'
import { ProviderService } from '../providers/provider-service'
import { createWeeklyLimitsStore } from '../settings/weekly-limits-store'
import { makeCompany, orgText, type TestCompany } from './test-company'

const made: string[] = []
afterEach(async () => {
  for (const d of made.splice(0)) await rm(d, { recursive: true, force: true })
})

async function handlers(open: boolean): Promise<{
  h: ReturnType<typeof createDomainHandlers>
  c: TestCompany
}> {
  const c: TestCompany = await makeCompany()
  const state = await mkdtemp(join(tmpdir(), 'mc-emp-state-'))
  made.push(c.dir, state)
  const context = new CompanyContext({
    store: { load: async () => null, save: async () => undefined },
    homeDir: '/nonexistent-home'
  })
  if (open) expect((await context.open(c.dir)).ok).toBe(true)
  return {
    h: createDomainHandlers({
      context,
      providers: new ProviderService(),
      limits: createWeeklyLimitsStore(state)
    }),
    c
  }
}
const hire = { templateId: 'designer', id: 'designer', department: '디자인팀', reportsTo: 'COO' }

describe('employee IPC handlers', () => {
  it('lists templates without a company and returns copies', async () => {
    const { h } = await handlers(false)
    const a = await h.listTemplates()
    expect(a.ok && a.value.length >= 8).toBe(true)
    if (a.ok) a.value[0].title = 'tampered'
    const b = await h.listTemplates()
    expect(b.ok && b.value[0].title).not.toBe('tampered')
  })

  it('reports no-company for writes without an open company', async () => {
    const { h } = await handlers(false)
    for (const r of [
      await h.createEmployee(hire),
      await h.updateEmployee({ id: 'pm', model: 'opus' }),
      await h.moveEmployee({ id: 'pm', department: 'x' }),
      await h.retireEmployee({ id: 'pm' })
    ])
      expect(!r.ok && r.code).toBe('no-company')
  })

  it('creates as ceo-ui and cannot be told otherwise', async () => {
    const { h, c } = await handlers(true)
    const spoof = await h.createEmployee({ ...hire, actor: 'approved-proposal' })
    expect(!spoof.ok && spoof.code).toBe('invalid-request')
    const r = await h.createEmployee(hire)
    expect(r.ok && r.value.record.actor).toBe('ceo-ui')
    expect(await orgText(c)).toContain('`designer`')
    expect(await readFile(join(c.dir, '.claude/agents/designer.md'), 'utf8')).toContain(
      'name: designer'
    )
  })

  it('shares the write queue so concurrent writes do not lose rows', async () => {
    const { h } = await handlers(true)
    const rs = await Promise.all([
      h.createEmployee(hire),
      h.createEmployee({
        ...hire,
        templateId: 'researcher',
        id: 'researcher',
        department: '리서치팀'
      }),
      h.moveEmployee({ id: 'developer', department: '플랫폼팀' })
    ])
    expect(rs.every((r) => r.ok)).toBe(true)
  })

  it('checks approval cards from the renderer against decided done cards', async () => {
    const { h } = await handlers(true)
    for (const approval of ['D-016', 'D-001', 'D-999']) {
      const bad = await h.retireEmployee({ id: 'developer', approval })
      expect(!bad.ok && bad.code, approval).toBe('approval-required')
    }
    expect((await h.retireEmployee({ id: 'developer', approval: 'D-012' })).ok).toBe(true)
  })

  it('never leaks the company path in errors', async () => {
    const { h, c } = await handlers(true)
    const results = [
      await h.createEmployee({ ...hire, id: '../../etc' }),
      await h.createEmployee({ ...hire, id: 'developer' }),
      await h.updateEmployee({ id: 'ghost', description: 'x' }),
      await h.moveEmployee({ id: 'cto', reportsTo: '개발자' }),
      await h.retireEmployee({ id: 'cto' })
    ]
    for (const r of results) {
      expect(r.ok).toBe(false)
      expect(JSON.stringify(r)).not.toContain(c.dir)
    }
  })

  it('rejects non-object payloads', async () => {
    const { h } = await handlers(true)
    for (const bad of [undefined, null, 5, 'x', [], () => 1])
      for (const fn of [h.createEmployee, h.updateEmployee, h.moveEmployee, h.retireEmployee])
        expect((await fn(bad)).ok).toBe(false)
  })
})
