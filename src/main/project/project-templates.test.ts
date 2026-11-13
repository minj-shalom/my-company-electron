import { readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ApiResult } from '../../shared/result'
import { PROJECT_TEMPLATE_IDS } from '../../shared/project-template'
import { EMPLOYEE_TEMPLATES } from '../employee/templates'
import { checkValues, PolicyService } from '../policy/policy-service'
import { readProjectItems } from './assignments-store'
import { makeProjectTest, type ProjectTest } from './test-project-company'
import {
  applyProjectTemplate,
  listProjectTemplates,
  missingStaffTemplates
} from './project-templates'

const tests: ProjectTest[] = []
afterEach(async () => {
  for (const t of tests.splice(0))
    for (const d of t.dirs) await rm(d, { recursive: true, force: true })
})

const ID = 'my-company'
async function setup(type?: 'content'): Promise<{
  t: ProjectTest
  policy: PolicyService
  deps: Parameters<typeof applyProjectTemplate>[0]
  file: string
}> {
  const t = await makeProjectTest()
  tests.push(t)
  if (type) await t.svc.setType({ id: ID, type })
  const policy = new PolicyService({ fs: t.c.fs, exclusive: (f) => t.c.repo.runExclusive(f) })
  const deps = { policy, readProjects: () => readProjectItems(t.c.fs) }
  const file = join(t.c.dir, 'company/policies', `${ID}.md`)
  return { t, policy, deps, file }
}
const code = (r: ApiResult<unknown>): string => (r.ok ? 'ok' : r.code)

describe('project template library', () => {
  it('has the allowed templates with PM first and known staff templates', () => {
    const list = listProjectTemplates()
    expect(list.map((t) => t.id)).toEqual([...PROJECT_TEMPLATE_IDS])
    for (const t of list) {
      expect(t.recommendedStaff[0].isPm).toBe(true)
      expect(t.recommendedStaff.filter((s) => s.isPm)).toHaveLength(1)
    }
    expect(missingStaffTemplates()).toEqual([])
  })
  it('returns copies so callers cannot mutate the library', () => {
    listProjectTemplates()[0].title = 'x'
    expect(listProjectTemplates()[0].title).not.toBe('x')
  })
  it('content staff templates forbid publishing before approval and credentials', () => {
    for (const id of ['writer', 'editor', 'script-writer', 'pm-content']) {
      const body = EMPLOYEE_TEMPLATES.find((t) => t.id === id)?.body ?? ''
      expect(body, id).toContain('CEO 승인')
      expect(body, id).toContain('자격 증명')
    }
  })
})

describe('project:apply-template', () => {
  it('creates the dev policy with conservative defaults and returns suggestions only', async () => {
    const { t, deps, file } = await setup()
    const r = await applyProjectTemplate(deps, { projectId: ID, templateId: 'dev-web-app' })
    if (!r.ok) throw new Error(r.message)
    expect(r.value.recommendedStaff.map((s) => s.templateId)).toEqual([
      'pm-dev',
      'developer',
      'reviewer-qa'
    ])
    const text = await readFile(file, 'utf8')
    expect(text).not.toContain('auto')
    const s = await deps.policy.get({ projectId: ID })
    if (!s.ok) throw new Error('get')
    expect(s.value.values).toMatchObject({
      flow: 'dev-git-pr',
      usePr: true,
      reviewStage: 'required'
    })
    expect(Object.values(s.value.effective.modes)).toEqual(['every', 'every', 'every', 'every'])
    // 직원 파일과 배정은 건드리지 않는다.
    const members = (await readProjectItems(t.c.fs)).find((p) => p.id === ID)
    expect(members?.pmId).toBeNull()
  })
  it.each(['content-blog', 'content-video'] as const)(
    '%s sets the content flow with a daily goal of 1',
    async (templateId) => {
      const { deps } = await setup('content')
      expect(code(await applyProjectTemplate(deps, { projectId: ID, templateId }))).toBe('ok')
      const s = await deps.policy.get({ projectId: ID })
      if (!s.ok) throw new Error('get')
      expect(s.value.values).toMatchObject({ flow: 'content-draft-approve', dailyOutputGoal: 1 })
      expect(s.value.warnings).toEqual([])
    }
  )
  it('refuses to overwrite an existing policy file', async () => {
    const { deps, file } = await setup()
    await mkdir(join(file, '..'), { recursive: true })
    await writeFile(file, '# 정책: my-company\n\n- 흐름: custom\n')
    const before = await readFile(file, 'utf8')
    expect(
      code(await applyProjectTemplate(deps, { projectId: ID, templateId: 'dev-web-app' }))
    ).toBe('conflict')
    expect(await readFile(file, 'utf8')).toBe(before)
  })
  it('rejects unknown templates, mismatched types, bad input and unknown projects', async () => {
    const { deps, file } = await setup()
    const bad = (r: unknown): Promise<string> => applyProjectTemplate(deps, r).then(code)
    expect(await bad({ projectId: ID, templateId: 'nope' })).toBe('invalid-request')
    expect(await bad({ projectId: ID, templateId: '__proto__' })).toBe('invalid-request')
    expect(await bad({ projectId: ID, templateId: 'content-blog' })).toBe('invalid-request')
    expect(await bad({ projectId: '../x', templateId: 'dev-web-app' })).toBe('invalid-request')
    expect(await bad({ projectId: ID, templateId: 'dev-web-app', extra: 1 })).toBe(
      'invalid-request'
    )
    expect(await bad(null)).toBe('invalid-request')
    expect(await bad({ projectId: 'nope', templateId: 'dev-web-app' })).toBe('not-found')
    await expect(readFile(file, 'utf8')).rejects.toThrow()
  })
  it('rejects a dev template on a content project and the reverse', async () => {
    const { deps } = await setup('content')
    expect(
      code(await applyProjectTemplate(deps, { projectId: ID, templateId: 'dev-web-app' }))
    ).toBe('invalid-request')
  })
  it('template policy values pass the T-047 immutable-rule validation', async () => {
    const { deps } = await setup()
    await applyProjectTemplate(deps, { projectId: ID, templateId: 'dev-web-app' })
    const s = await deps.policy.get({ projectId: ID })
    if (!s.ok) throw new Error('get')
    expect('values' in checkValues(s.value.values)).toBe(true)
  })
  it('does not leak filesystem paths in errors', async () => {
    const { t, deps } = await setup()
    const r = await applyProjectTemplate(deps, { projectId: 'nope', templateId: 'dev-web-app' })
    expect(JSON.stringify(r)).not.toContain(t.c.dir)
  })
})
