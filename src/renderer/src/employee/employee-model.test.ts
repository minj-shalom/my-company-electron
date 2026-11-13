import { describe, expect, it } from 'vitest'
import { mockGetOrg } from '../mock-org'
import type { OrgMember, OrgSnapshot } from '../../../shared/org'
import {
  buildCreateRequest,
  buildMoveRequest,
  buildUpdateRequest,
  defaultsFor,
  errorText,
  initialEdit,
  isEditDirty,
  mayNeedApproval,
  needsLeaveConfirm,
  groupTemplates,
  orderTemplates,
  parseToolInput,
  retireBlockReason,
  validateEdit,
  validateHire,
  validateMove
} from './employee-model'
import { MOCK_TEMPLATES } from '../mock-hire'

async function snap(): Promise<OrgSnapshot> {
  const r = await mockGetOrg('normal')()
  if (!r.ok) throw new Error('mock')
  return r.value
}

describe('validateHire', () => {
  it('guides on bad id, duplicate id and duplicate title', async () => {
    const s = await snap()
    const base = { templateId: 'pm', id: 'x', title: 'Z', department: '개발팀', reportsTo: 'COO' }
    expect(validateHire(base, s)).toEqual({})
    expect(validateHire({ ...base, id: 'Bad Id' }, s).id).toMatch(/영문 소문자/)
    expect(validateHire({ ...base, id: 'pm' }, s).id).toMatch(/이미/)
    expect(validateHire({ ...base, title: ' pm ' }, s).title).toMatch(/이미/)
    expect(validateHire({ ...base, department: '없는팀' }, s).department).toBeDefined()
  })
  it('puts the PM template first and fills defaults', async () => {
    const s = await snap()
    const ordered = orderTemplates([...MOCK_TEMPLATES].reverse())
    expect(ordered[0].id).toBe('pm')
    const d = defaultsFor(MOCK_TEMPLATES[1], s)
    expect(d).toMatchObject({ department: '개발팀', reportsTo: 'COO', id: '' })
    expect(buildCreateRequest({ ...d, id: 'dev-2', title: '개발자' }, MOCK_TEMPLATES[1])).toEqual({
      templateId: 'developer',
      id: 'dev-2',
      department: '개발팀',
      reportsTo: 'COO'
    })
  })
})

describe('groupTemplates', () => {
  it('groups by department without required staff', () => {
    const groups = groupTemplates(MOCK_TEMPLATES)
    const names = groups.map((g) => g.department)
    expect(new Set(names).size).toBe(names.length)
    expect(names).toContain('콘텐츠팀')
    expect(groups.find((g) => g.department === '콘텐츠팀')?.templates).toHaveLength(5)
    const ids = groups.flatMap((g) => g.templates.map((t) => t.id))
    expect(ids).not.toEqual(expect.arrayContaining(['cto']))
    expect(ids).not.toContain('hr')
    expect(groupTemplates([])).toEqual([])
  })
})

describe('edit', () => {
  it('builds only changed fields and keeps blank prompt unchanged', async () => {
    const s = await snap()
    const a = s.agents.find((x) => x.id === 'developer')
    const init = initialEdit(a)
    expect(buildUpdateRequest('developer', init, init)).toBeNull()
    const next = { ...init, description: ' 새 설명 ', tools: ['Read'], body: '새 프롬프트' }
    expect(buildUpdateRequest('developer', init, next)).toEqual({
      id: 'developer',
      description: '새 설명',
      tools: ['Read'],
      body: '새 프롬프트'
    })
    expect(isEditDirty(init, next)).toBe(true)
    expect(isEditDirty(init, { ...init })).toBe(false)
  })
  it('validates and warns about approval', async () => {
    const init = initialEdit({
      id: 'x',
      name: 'x',
      description: 'd',
      model: 'sonnet',
      tools: ['Read']
    })
    expect(validateEdit({ ...init, description: ' ' }).description).toBeDefined()
    expect(validateEdit({ ...init, tools: ['bad tool!'] }).tools).toBeDefined()
    expect(mayNeedApproval(init, { ...init, tools: ['Read', 'Bash'] })).toBe(true)
    expect(mayNeedApproval(init, { ...init, tools: [] })).toBe(true)
    expect(mayNeedApproval(init, init)).toBe(false)
    expect(parseToolInput('Read, Grep  Read')).toEqual(['Read', 'Grep'])
  })
})

describe('move and retire', () => {
  it('rejects cycles and department leads with fixed sentences', async () => {
    const s = await snap()
    const cto = s.org.members.find((m) => m.title === 'CTO')!
    const dev = s.org.members.find((m) => m.title === '개발자')!
    expect(validateMove(s, cto, { department: 'R&D', reportsTo: '개발자' })).toMatch(/순환/)
    expect(validateMove(s, cto, { department: 'R&D', reportsTo: 'CTO' })).toMatch(/자기 자신/)
    expect(validateMove(s, dev, { department: '기획팀', reportsTo: 'CTO' })).toMatch(/부서장/)
    expect(validateMove(s, dev, { department: '개발팀', reportsTo: 'COO' })).toBeNull()
    expect(
      buildMoveRequest('developer', dev, { department: '개발팀', reportsTo: 'CTO' })
    ).toBeNull()
    expect(buildMoveRequest('developer', dev, { department: '개발팀', reportsTo: 'COO' })).toEqual({
      id: 'developer',
      reportsTo: 'COO'
    })
  })
  it('blocks retire for managers, leads and PMs of projects', async () => {
    const s = await snap()
    const by = (t: string): OrgMember => s.org.members.find((m) => m.title === t)!
    expect(retireBlockReason(s, by('CTO'), [])).toMatch(/보고하는 직원/)
    expect(retireBlockReason(s, by('개발자'), [])).toMatch(/부서장/)
    expect(retireBlockReason(s, by('QA'), [])).toBeNull()
    expect(retireBlockReason(s, by('PM'), ['앱'])).toMatch(/대체 PM/)
    expect(retireBlockReason(s, by('COO'), [])).toMatch(/AI 직원/)
  })
  it('never echoes main messages', () => {
    expect(errorText('conflict', 'move')).not.toMatch(/mock/)
    expect(errorText('approval-required', 'retire')).toMatch(/승인/)
  })
})

describe('leave confirmation', () => {
  it('asks only when dirty and the selection would change (select or hire)', () => {
    expect(needsLeaveConfirm(true, 'QA', 'PM')).toBe(true)
    expect(needsLeaveConfirm(true, 'QA', 'QA')).toBe(false)
    expect(needsLeaveConfirm(false, 'QA', 'PM')).toBe(false)
    expect(needsLeaveConfirm(true, null, 'new-hire')).toBe(true)
  })
})

describe('top-level member move', () => {
  it('allows moving only the department when reportsTo is empty and originally null', async () => {
    const s = await snap()
    const ceo = s.org.members.find((m) => m.title === 'CEO')!
    expect(validateMove(s, ceo, { department: '경영', reportsTo: '' })).toBeNull()
    expect(buildMoveRequest('ceo', ceo, { department: '경영', reportsTo: '' })).toBeNull()
    expect(buildMoveRequest('ceo', ceo, { department: 'R&D', reportsTo: '' })).toEqual({
      id: 'ceo',
      department: 'R&D'
    })
    const dev = s.org.members.find((m) => m.title === '개발자')!
    expect(validateMove(s, dev, { department: '개발팀', reportsTo: '' })).toMatch(/보고 대상/)
  })
})
