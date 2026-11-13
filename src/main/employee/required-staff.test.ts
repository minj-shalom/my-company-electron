import { rm } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import type { ApiResult } from '../../shared/result'
import { loadOrg } from '../org/org-store'
import { checkBody, checkDescription, checkModel, checkTools, verifyAgentFile } from './agent-file'
import { makeCompany, orgText, snapshotAgents, type TestCompany } from './test-company'
import { EMPLOYEE_TEMPLATES, REQUIRED_STAFF_IDS } from './templates'

const made: TestCompany[] = []
async function company(): Promise<TestCompany> {
  const c = await makeCompany()
  made.push(c)
  return c
}
afterEach(async () => {
  for (const c of made.splice(0)) await rm(c.dir, { recursive: true, force: true })
})
const code = (r: ApiResult<unknown>): string => (r.ok ? 'ok' : r.code)

const CONTENT_IDS = [
  'content-planner',
  'blog-writer',
  'video-planner',
  'video-editor',
  'sns-marketer'
]

describe('required staff are not hireable', () => {
  it('keeps cto, cfo, hr out of the template list', () => {
    const ids = EMPLOYEE_TEMPLATES.map((t) => t.id)
    for (const id of REQUIRED_STAFF_IDS) expect(ids).not.toContain(id)
    expect(REQUIRED_STAFF_IDS).toEqual(['cto', 'cfo', 'hr'])
  })

  const attempts: Array<[string, Record<string, unknown>]> = [
    ['required template with a new id', { templateId: 'cto', id: 'cto-2', title: '기술 고문' }],
    ['required template, default title', { templateId: 'hr', id: 'people', department: '인사팀' }],
    ['hireable template with a required id', { templateId: 'designer', id: 'cfo' }],
    ['required title on a hireable template', { templateId: 'designer', id: 'x1', title: 'CTO' }],
    ['title in other case', { templateId: 'designer', id: 'x2', title: 'cfo' }],
    ['title with padding spaces', { templateId: 'designer', id: 'x3', title: ' 인사 ' }],
    ['full-width title', { templateId: 'designer', id: 'x4', title: 'ＣＴＯ' }],
    ['COO title', { templateId: 'designer', id: 'x5', title: 'COO' }],
    ['uppercase id', { templateId: 'designer', id: 'CTO' }],
    ['file name id', { templateId: 'designer', id: 'cto.md' }],
    ['path id', { templateId: 'designer', id: '../agents/hr' }],
    ['uppercase template id', { templateId: 'CTO', id: 'cto-3' }],
    ['required title override on restore shape', { templateId: 'cfo', id: 'cfo', title: 'CFO 2' }],
    ['restore shape with a role override', { templateId: 'cfo', id: 'cfo', role: '다른 역할' }]
  ]
  it.each(attempts)('rejects %s without writing', async (_n, extra) => {
    const c = await company()
    const before = await snapshotAgents(c)
    const orgBefore = await orgText(c)
    const r = await c.service.create(
      { department: '개발팀', reportsTo: 'COO', approval: 'D-012', ...extra },
      'ceo-ui'
    )
    expect(r.ok).toBe(false)
    expect(await snapshotAgents(c)).toEqual(before)
    expect(await orgText(c)).toBe(orgBefore)
  })

  it('rejects duplicate hires of existing required staff', async () => {
    const c = await company()
    for (const id of REQUIRED_STAFF_IDS) {
      const r = await c.service.create(
        { templateId: id, id, department: 'x', reportsTo: 'COO' },
        'ceo-ui'
      )
      expect(code(r)).not.toBe('ok')
    }
  })
})

describe('content templates', () => {
  it('has the five content roles with unique ids and titles', () => {
    const ids = EMPLOYEE_TEMPLATES.map((t) => t.id)
    for (const id of CONTENT_IDS) expect(ids).toContain(id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(EMPLOYEE_TEMPLATES.map((t) => t.title)).size).toBe(ids.length)
  })

  it.each(CONTENT_IDS)('%s has minimal tools and passes the agent file validators', (id) => {
    const t = EMPLOYEE_TEMPLATES.find((e) => e.id === id)
    if (!t) throw new Error('missing template')
    expect(t.tools).not.toContain('Bash')
    expect(t.tools).toEqual(['Read', 'Write', 'Edit', 'Grep', 'Glob'])
    expect(t.body).toContain('drafts/')
    expect(t.body).toContain('발행')
    expect(checkDescription(t.description).ok).toBe(true)
    expect(checkModel(t.model).ok).toBe(true)
    expect(checkTools(t.tools).ok).toBe(true)
    expect(checkBody(t.body).ok).toBe(true)
    expect(
      verifyAgentFile(
        `---\nname: ${t.id}\ndescription: ${t.description}\ntools: ${t.tools.join(', ')}\nmodel: ${t.model}\n---\n\n${t.body.trim()}\n`,
        {
          name: t.id,
          description: t.description,
          model: t.model,
          tools: t.tools,
          body: `${t.body.trim()}\n`
        }
      )
    ).toBe(true)
  })

  it.each(CONTENT_IDS)('%s can be hired through the real service', async (id) => {
    const c = await company()
    const t = EMPLOYEE_TEMPLATES.find((e) => e.id === id)
    const r = await c.service.create(
      { templateId: id, id, department: t?.department ?? '콘텐츠팀', reportsTo: 'COO' },
      'ceo-ui'
    )
    expect(code(r)).toBe('ok')
    expect((await loadOrg(c.fs)).issues).toEqual([])
  })
})
