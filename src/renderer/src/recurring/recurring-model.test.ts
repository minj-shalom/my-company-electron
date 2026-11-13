import { describe, expect, it } from 'vitest'
import type { RecurringItem } from '../../../shared/recurring'
import {
  buildCadence,
  cadenceLabel,
  draftOf,
  emptyDraft,
  goalNotes,
  newRecurringId,
  nextRunText,
  recurringErrorText,
  runRecurringAction,
  toDefinition,
  validateDraft
} from './recurring-model'

const item = (over: Partial<RecurringItem> = {}): RecurringItem => ({
  id: 'a',
  projectId: 'p',
  titleTemplate: '글 {date}',
  goalTemplate: '쓴다',
  criteriaTemplates: ['초안'],
  cadence: 'daily',
  count: 1,
  assignee: null,
  status: 'active',
  nextRunAt: null,
  createdToday: false,
  ...over
})

describe('goalNotes', () => {
  it('flags a mismatch between goal and daily count, ignoring paused and weekly', () => {
    const items = [
      item({ count: 1 }),
      item({ id: 'b', count: 2, status: 'paused' }),
      item({ id: 'c', cadence: 'weekly:월', count: 3 })
    ]
    expect(goalNotes(items, new Map([['p', 2]])).get('p')).toMatchObject({
      perDay: 1,
      mismatch: true
    })
    expect(goalNotes(items, new Map([['p', 1]])).get('p')?.mismatch).toBe(false)
  })
  it('does not compare when no goal is set', () => {
    expect(goalNotes([item()], new Map()).get('p')?.mismatch).toBe(false)
  })
})

describe('draft', () => {
  it('rejects empty and out-of-range input', () => {
    const e = validateDraft({ ...emptyDraft('p'), count: '9' })
    expect(Object.keys(e).sort()).toEqual(['count', 'criteria', 'goal', 'title'])
  })
  it('round-trips a definition', () => {
    const def = toDefinition(
      {
        ...emptyDraft('p'),
        title: ' 글 {date} ',
        goal: '쓴다',
        criteria: '가\n\n나 ',
        cadenceKind: 'weekly',
        day: '금',
        assignee: 'dev'
      },
      'x',
      'paused'
    )
    expect(def).toMatchObject({
      titleTemplate: '글 {date}',
      criteriaTemplates: ['가', '나'],
      cadence: 'weekly:금',
      assignee: 'dev',
      status: 'paused'
    })
    expect(validateDraft(draftOf(def))).toEqual({})
  })
  it('makes unique valid ids', () => {
    const draws = [0, 0.5]
    const id = newRecurringId(new Set(['rec-000000']), () => draws.shift() ?? 0.9)
    expect(id).not.toBe('rec-000000')
    expect(id).toMatch(/^rec-[a-z0-9]{6}$/)
  })
})

describe('text helpers', () => {
  it('labels cadence', () => {
    expect(cadenceLabel(buildCadence('weekly', '수'))).toBe('매주 수요일')
    expect(cadenceLabel('weekdays')).toBe('평일(월-금)')
  })
  it('explains next run', () => {
    const now = 1_000
    expect(nextRunText(item({ status: 'paused' }), now)).toContain('일시정지')
    expect(nextRunText(item({ nextRunAt: now }), now)).toContain('자동 점검')
    expect(nextRunText(item({ nextRunAt: now, createdToday: true }), now)).toContain('만들었어요')
    expect(nextRunText(item({ nextRunAt: now + 86_400_000 }), now)).toMatch(
      /\d+월 \d+일\(.\) \d\d:\d\d/
    )
  })
  it('maps error codes to plain words and hides raw messages', () => {
    for (const c of ['invalid-request', 'conflict', 'not-found', 'no-company', 'internal'])
      expect(recurringErrorText(c)).not.toMatch(/[a-z]{4,}/)
  })
  it('turns failures and throws into messages', async () => {
    expect(
      await runRecurringAction(async () => ({ ok: false, code: 'conflict' }), 'ok')
    ).toMatchObject({ ok: false })
    expect(
      await runRecurringAction(async () => {
        throw new Error('/secret/path')
      }, 'ok')
    ).toEqual({
      ok: false,
      message: recurringErrorText('internal')
    })
  })
})
