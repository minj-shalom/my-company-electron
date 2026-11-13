import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ApiResult } from '../../shared/result'
import { loadOrg } from '../org/org-store'
import { checkBody, checkDescription, checkModel, checkTools, verifyAgentFile } from './agent-file'
import { makeCompany, orgText, snapshotAgents, type TestCompany } from './test-company'
import { REQUIRED_STAFF_MESSAGE } from './employee-service'
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
    ['zero-width title', { templateId: 'designer', id: 'x6', title: 'C\u200BTO' }],
    ['soft hyphen title', { templateId: 'designer', id: 'x7', title: 'C\u00ADFO' }],
    ['ideographic space title', { templateId: 'designer', id: 'x8', title: '인\u3000사' }],
    ['file name title', { templateId: 'designer', id: 'x9', title: 'cto.md' }],
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
    const r = await c.service.create({ department: '개발팀', reportsTo: 'COO', ...extra }, 'ceo-ui')
    // 승인 카드나 id 형식 검사가 아니라 새 필수 인원 검사가 막았는지 확인한다.
    expect(r).toEqual({ ok: false, code: 'invalid-request', message: REQUIRED_STAFF_MESSAGE })
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

describe('base role restore and other paths', () => {
  async function without(c: TestCompany, id: string): Promise<void> {
    const org = await readFile(join(c.dir, 'company/org.md'), 'utf8')
    await writeFile(
      join(c.dir, 'company/org.md'),
      org
        .split('\n')
        .filter((l) => !l.includes(`\`${id}\``))
        .join('\n')
    )
    await rm(join(c.dir, `.claude/agents/${id}.md`))
  }
  const restore = { templateId: 'hr', id: 'hr', department: '인사팀', reportsTo: 'COO' }

  it('restores a missing base role as-is, only from a ceo click', async () => {
    const c = await company()
    await without(c, 'hr')
    expect(code(await c.service.create({ ...restore, department: '개발팀' }, 'ceo-ui'))).toBe(
      'invalid-request'
    )
    expect(code(await c.service.create({ ...restore, reportsTo: 'CTO' }, 'ceo-ui'))).toBe(
      'invalid-request'
    )
    expect(code(await c.service.create(restore, 'approved-proposal'))).toBe('approval-required')
    expect(code(await c.service.create(restore, 'ceo-ui'))).toBe('ok')
    expect(code(await c.service.create(restore, 'ceo-ui'))).toBe('conflict')
  })

  it('rejects renaming another employee to a required or protected title', async () => {
    const c = await company()
    await c.service.create(
      { templateId: 'designer', id: 'designer', department: '디자인팀', reportsTo: 'COO' },
      'ceo-ui'
    )
    for (const title of ['CTO', 'c\u200Bfo', 'cto.md', '인사']) {
      const r = await c.service.move({ id: 'designer', title }, 'ceo-ui')
      expect(r, title).toEqual({
        ok: false,
        code: 'invalid-request',
        message: REQUIRED_STAFF_MESSAGE
      })
    }
    const coo = await c.service.move({ id: 'designer', title: 'C\u200BOO' }, 'ceo-ui')
    expect(code(coo)).toBe('forbidden')
  })
})
