import { describe, expect, it } from 'vitest'
import type { ProjectInfo } from '../../../shared/project'
import {
  assigneeChoices,
  assigneeFor,
  draftFromTicket,
  EMPTY_DRAFT,
  hasErrors,
  needsPm,
  parseTicketBody,
  projectChoices,
  saveErrorText,
  toRequestFields,
  validateDraft,
  type FormOptions
} from './ticket-form-model'

const proj = (over: Partial<ProjectInfo>): ProjectInfo => ({
  id: 'a',
  name: '앱',
  type: 'development',
  path: '/x',
  devCommand: null,
  defaultBranch: null,
  status: 'active',
  pmId: 'pm',
  pm: null,
  state: 'ready',
  git: { status: 'not-repo' },
  ...over
})
const options = (projects: ProjectInfo[]): FormOptions => ({
  projects,
  employees: [{ id: 'pm', name: '피엠', title: 'PM' }],
  projectsFailed: false,
  employeesFailed: false
})

describe('parseTicketBody', () => {
  it('reads goal, criteria and project id, ignoring other sections', () => {
    const body = [
      '# T-001: x',
      '- **프로젝트:** `landing`',
      '## 목표',
      '한 줄',
      '둘째 줄',
      '## 완료 조건',
      '- [ ] 하나',
      '- [x] 둘',
      '## 메모',
      '- 무시'
    ].join('\n')
    expect(parseTicketBody(body)).toEqual({
      goal: '한 줄\n둘째 줄',
      criteria: ['하나', '둘'],
      projectId: 'landing'
    })
  })
  it('tolerates a body without sections and bad project ids', () => {
    expect(parseTicketBody('- **프로젝트:** ../x')).toEqual({
      goal: '',
      criteria: [],
      projectId: null
    })
    expect(
      draftFromTicket({ id: 'T-1', title: 't', status: 'backlog', assignee: null, body: '' })
    ).toMatchObject({ criteria: [''], assignee: '', projectId: '' })
  })
})

describe('validateDraft', () => {
  it('requires title and at least one criterion', () => {
    const e = validateDraft(EMPTY_DRAFT)
    expect(e.title).toBeDefined()
    expect(e.criteria).toBeDefined()
    expect(hasErrors(e)).toBe(true)
  })
  it('flags limits and structural goal lines', () => {
    const e = validateDraft({
      ...EMPTY_DRAFT,
      title: 'a'.repeat(101),
      goal: '# 제목\n내용',
      criteria: ['b'.repeat(301)]
    })
    expect(e.title).toContain('100')
    expect(e.goal).toContain('#')
    expect(e.rows[0]).toContain('300')
  })
  it('accepts a valid draft and drops blank rows on submit', () => {
    const d = { ...EMPTY_DRAFT, title: ' 제목 ', criteria: [' 하나 ', '  ', '둘'] }
    expect(hasErrors(validateDraft(d))).toBe(false)
    expect(toRequestFields(d)).toMatchObject({
      title: '제목',
      criteria: ['하나', '둘'],
      assignee: null,
      projectId: null
    })
  })
})

describe('choices', () => {
  const o = options([
    proj({ id: 'a', name: '앱' }),
    proj({ id: 'old', name: '옛', status: 'archived', state: 'archived' }),
    proj({ id: 'n', name: '새', state: 'pm-required', pmId: null })
  ])
  it('lists active projects plus 회사 공통 and keeps an archived current value', () => {
    expect(projectChoices(o, '').map((c) => c.label)).toEqual(['회사 공통', '앱', '새'])
    expect(projectChoices(o, 'old').at(-1)?.label).toBe('옛 (보관됨)')
    expect(projectChoices(o, 'zzz').at(-1)?.label).toBe('알 수 없는 프로젝트')
  })
  it('defaults assignee to the ready project PM and flags PM-required', () => {
    expect(assigneeFor(o.projects, 'a')).toBe('pm')
    expect(assigneeFor(o.projects, 'n')).toBe('')
    expect(assigneeFor(o.projects, '')).toBe('')
    expect(needsPm(o, 'n')).toBe(true)
    expect(needsPm(o, 'a')).toBe(false)
  })
  it('keeps an assignee missing from the org', () => {
    expect(assigneeChoices(o, 'ghost').at(-1)?.label).toContain('조직에 없음')
    expect(assigneeChoices(o, '').map((c) => c.value)).toEqual(['', 'pm'])
  })
})

describe('saveErrorText', () => {
  it('maps codes to Korean text without leaking details', () => {
    expect(saveErrorText('conflict', '/secret/path')).not.toContain('/secret')
    expect(saveErrorText('forbidden', '')).toContain('진행 중')
    expect(saveErrorText('internal', '/secret')).not.toContain('/secret')
  })
})
