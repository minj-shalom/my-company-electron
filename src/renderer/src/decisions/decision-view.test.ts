import { describe, expect, it } from 'vitest'
import { DECISION_KINDS, type Decision } from '../../../shared/decision'
import {
  applyResolved,
  countByKind,
  filterByKind,
  filterUnreadable,
  KIND_META,
  loadDecisionState,
  MEMO_MAX,
  mergeRefresh,
  normalizeKind,
  pendingCount,
  resolveErrorText,
  sanitizeMemo,
  shouldRefetchOnFocus,
  shouldRefreshAfterError,
  splitDecisions,
  unreadableReasonText,
  unreadableSummary,
  type DecisionsState
} from './decision-view'

const d = (id: string, status: Decision['status'], kind?: Decision['kind']): Decision => ({
  id,
  title: id,
  status,
  ticketId: null,
  question: 'q',
  options: [{ key: 'A', label: 'a', description: '' }],
  recommended: null,
  chosen: null,
  memo: '',
  kind
})

describe('kind mapping', () => {
  it('has meta for every allowed kind', () => {
    for (const k of DECISION_KINDS) expect(KIND_META[k].label.length).toBeGreaterThan(0)
  })
  it('treats unknown, missing and prototype keys as a plain decision', () => {
    expect(normalizeKind(undefined)).toBe('decision')
    expect(normalizeKind('nope')).toBe('decision')
    expect(normalizeKind('__proto__')).toBe('decision')
    expect(normalizeKind('git-confirm')).toBe('git-confirm')
  })
  it('filters and counts by kind', () => {
    const items = [
      d('D-1', 'pending'),
      d('D-2', 'pending', 'permission'),
      d('D-3', 'pending', 'permission')
    ]
    expect(filterByKind(items, 'all')).toHaveLength(3)
    expect(filterByKind(items, 'permission').map((x) => x.id)).toEqual(['D-2', 'D-3'])
    expect(filterByKind(items, 'decision').map((x) => x.id)).toEqual(['D-1'])
    expect(countByKind(items)).toMatchObject({ decision: 1, permission: 2, proposal: 0 })
  })
})

describe('splitDecisions', () => {
  it('orders pending ascending and done descending by id number', () => {
    const r = splitDecisions([
      d('D-010', 'pending'),
      d('D-002', 'pending'),
      d('D-001', 'done'),
      d('D-007', 'done')
    ])
    expect(r.pending.map((x) => x.id)).toEqual(['D-002', 'D-010'])
    expect(r.done.map((x) => x.id)).toEqual(['D-007', 'D-001'])
  })
})

describe('unreadable', () => {
  const list = [
    { path: 'decisions/pending/a.md', reason: 'unreadable' as const },
    { path: 'decisions/done/b.md', reason: 'duplicate' as const },
    { path: 'weird/c.md', reason: 'too-large' as const }
  ]
  it('keeps only the folder being shown and never hides unknown prefixes', () => {
    expect(filterUnreadable(list, 'pending').map((u) => u.path)).toEqual([
      'decisions/pending/a.md',
      'weird/c.md'
    ])
    expect(filterUnreadable(list, 'done').map((u) => u.path)).toEqual([
      'decisions/done/b.md',
      'weird/c.md'
    ])
  })
  it('writes Korean reasons and falls back for unknown ones', () => {
    expect(unreadableReasonText('duplicate')).toContain('같은 번호')
    expect(unreadableReasonText('too-large')).toContain('너무 커')
    expect(unreadableReasonText('weird')).toBe(unreadableReasonText('unreadable'))
    expect(unreadableReasonText('constructor')).toBe(unreadableReasonText('unreadable'))
    expect(unreadableSummary(3)).toBe('읽지 못한 카드 3건 (파일 확인 필요)')
  })
})

describe('error text and refresh policy', () => {
  it('maps codes to fixed Korean text without server detail', () => {
    for (const c of [
      'invalid-request',
      'not-found',
      'conflict',
      'no-company',
      'internal'
    ] as const) {
      expect(resolveErrorText(c)).toMatch(/[가-힣]/)
    }
    expect(resolveErrorText('conflict')).not.toBe(resolveErrorText('internal'))
  })
  it('refreshes only when the card is stale', () => {
    expect(shouldRefreshAfterError('conflict')).toBe(true)
    expect(shouldRefreshAfterError('not-found')).toBe(true)
    expect(shouldRefreshAfterError('internal')).toBe(false)
    expect(shouldRefreshAfterError('invalid-request')).toBe(false)
  })
  it('debounces focus refetch', () => {
    expect(shouldRefetchOnFocus(null, 1000)).toBe(true)
    expect(shouldRefetchOnFocus(1000, 1500)).toBe(false)
    expect(shouldRefetchOnFocus(1000, 9000)).toBe(true)
  })
})

describe('sanitizeMemo', () => {
  it('strips control characters, keeps text, and caps length', () => {
    expect(sanitizeMemo('a\u0000b\nc\td\u007fe f')).toBe('abcdef')
    expect(sanitizeMemo('가나다')).toBe('가나다')
    expect(sanitizeMemo('x'.repeat(MEMO_MAX + 5))).toHaveLength(MEMO_MAX)
  })
})

describe('state loading', () => {
  it('returns ready, error and thrown-error states', async () => {
    const ok = await loadDecisionState({
      listDecisions: async () => ({
        ok: true,
        value: { items: [d('D-1', 'pending')], unreadable: [] }
      })
    })
    expect(ok).toMatchObject({ kind: 'ready', stale: false })
    const bad = await loadDecisionState({
      listDecisions: async () => ({ ok: false, code: 'internal', message: '/Users/x/secret' })
    })
    expect(bad.kind === 'error' && bad.message).not.toContain('/Users')
    const thrown = await loadDecisionState({
      listDecisions: async () => {
        throw new Error('/Users/x')
      }
    })
    expect(thrown.kind).toBe('error')
  })
  it('keeps the previous list as stale when a refresh fails', () => {
    const prev: DecisionsState = {
      kind: 'ready',
      items: [d('D-1', 'pending')],
      unreadable: [],
      stale: false
    }
    const merged = mergeRefresh(prev, { kind: 'error', message: 'x' })
    expect(merged).toMatchObject({ kind: 'ready', stale: true })
    expect(mergeRefresh({ kind: 'loading' }, { kind: 'error', message: 'x' }).kind).toBe('error')
  })
  it('moves a resolved card to done and updates the pending count', () => {
    const prev: DecisionsState = {
      kind: 'ready',
      items: [d('D-1', 'pending'), d('D-2', 'pending')],
      unreadable: [],
      stale: false
    }
    expect(pendingCount(prev)).toBe(2)
    const next = applyResolved(prev, { ...d('D-1', 'done'), chosen: 'A' })
    expect(pendingCount(next)).toBe(1)
    expect(pendingCount({ kind: 'loading' })).toBe(0)
  })
})
