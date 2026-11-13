import { describe, expect, it } from 'vitest'
import type { PolicyValues, PolicyViolationCode } from '../../../shared/policy'
import { POLICY_ACTIONS } from '../../../shared/policy'
import {
  actionLabels,
  autoChanges,
  checkDraft,
  describeAuto,
  failureText,
  flowLabels,
  hasProtectedTarget,
  immutableRules,
  latestFirst,
  parseList,
  policyBadge,
  setMode,
  submitPolicy,
  uniqueMessages,
  violationText,
  visibleActions,
  warningText
} from './policy-model'
import type { WindowApi } from '../../../shared/api'

const base = (): PolicyValues => ({
  flow: 'dev-git-pr',
  modes: { push: 'every', merge: 'every', publish: 'every', 'draft-approve': 'every' },
  dailyLimits: {},
  autoPushPrefixes: [],
  autoMergeBranches: [],
  confirmInput: null,
  branchPrefix: 'feature/',
  baseBranch: 'develop',
  usePr: true,
  reviewStage: 'required',
  dailyOutputGoal: 0,
  outputDir: 'drafts/',
  publishAdapter: 'manual',
  activeHours: null,
  memo: null
})
const auto = (over: Partial<PolicyValues>): PolicyValues => ({
  ...base(),
  modes: { ...base().modes, push: 'auto' },
  dailyLimits: { push: 10 },
  autoPushPrefixes: ['feature/'],
  ...over
})

describe('autoChanges', () => {
  it('needs no confirm when nothing is auto or auto turned off', () => {
    expect(autoChanges(base(), base())).toEqual([])
    expect(autoChanges(auto({}), base())).toEqual([])
  })
  it('needs confirm when auto is turned on or its settings change', () => {
    expect(autoChanges(base(), auto({}))).toEqual(['push'])
    expect(autoChanges(auto({}), auto({}))).toEqual([])
    expect(autoChanges(auto({}), auto({ dailyLimits: { push: 20 } }))).toEqual(['push'])
    expect(autoChanges(auto({}), auto({ autoPushPrefixes: ['fix/'] }))).toEqual(['push'])
  })
})

describe('checkDraft', () => {
  it('passes a conservative draft', () => {
    expect(checkDraft(base(), '앱')).toEqual([])
  })
  it('requires limit and targets for auto', () => {
    expect(checkDraft(auto({ dailyLimits: {} }), '앱')[0]).toContain('일일 상한')
    expect(checkDraft(auto({ dailyLimits: { push: 51 } }), '앱')[0]).toContain('50')
    expect(checkDraft(auto({ autoPushPrefixes: [] }), '앱')[0]).toContain('접두어')
  })
  it('requires PR and review for auto merge', () => {
    const d = auto({
      modes: { ...base().modes, merge: 'auto' },
      autoMergeBranches: ['develop'],
      dailyLimits: { merge: 3 },
      usePr: false
    })
    expect(checkDraft(d, '앱').join()).toContain('PR 사용')
  })
  it('protected branch needs exact name and limit 1-2', () => {
    const d = auto({
      modes: { ...base().modes, merge: 'auto' },
      autoMergeBranches: ['master'],
      dailyLimits: { merge: 3 },
      confirmInput: '앱 '
    })
    const msgs = checkDraft(d, '앱').join('\n')
    expect(msgs).toContain('1~2회')
    expect(msgs).toContain('프로젝트 이름')
    expect(checkDraft({ ...d, dailyLimits: { merge: 2 }, confirmInput: '앱' }, '앱')).toEqual([])
  })
})

describe('helpers', () => {
  it('maps every violation code to fixed Korean text', () => {
    const codes: PolicyViolationCode[] = [
      'immutable-relaxed',
      'auto-needs-ceo',
      'auto-needs-confirm',
      'auto-limit-missing',
      'auto-limit-exceeded',
      'auto-target-missing',
      'auto-target-invalid',
      'auto-requirement-missing',
      'protected-merge-unconfirmed',
      'protected-limit-exceeded',
      'invalid-value',
      'file-too-large'
    ]
    for (const c of codes) expect(violationText(c)).toMatch(/[가-힣]/)
  })
  it('detects protected targets', () => {
    expect(hasProtectedTarget(['develop', 'Master'])).toBe(true)
    expect(hasProtectedTarget(['develop'])).toBe(false)
  })
  it('parses lists', () => {
    expect(parseList('a, b  a\nc')).toEqual(['a', 'b', 'c'])
  })
  it('flow decides visible actions', () => {
    expect(visibleActions('dev-git-pr')).toEqual(['push', 'merge'])
    expect(visibleActions('content-draft-approve')).toEqual(['publish', 'draft-approve'])
    expect(visibleActions('custom')).toEqual([...POLICY_ACTIONS])
  })
  it('auto merge forces PR and review', () => {
    const d = setMode({ ...base(), usePr: false, reviewStage: 'recommended' }, 'merge', 'auto')
    expect(d.usePr && d.reviewStage === 'required').toBe(true)
  })
  it('badge only for auto', () => {
    expect(policyBadge(undefined)).toBeNull()
    const s = {
      projectId: 'a',
      exists: true,
      autoActions: [],
      protectedMergeEnabled: false,
      warningCount: 0
    }
    expect(policyBadge(s)).toBeNull()
    expect(policyBadge({ ...s, autoActions: ['push'] })?.tone).toBe('warn')
    expect(policyBadge({ ...s, autoActions: ['merge'], protectedMergeEnabled: true })?.tone).toBe(
      'bad'
    )
  })
  it('history latest first, unique messages', () => {
    expect(
      latestFirst([
        { at: '1', actor: 'a', summary: 'x' },
        { at: '2', actor: 'a', summary: 'y' }
      ])[0].at
    ).toBe('2')
    expect(uniqueMessages(['a', 'a', 'b'])).toEqual(['a', 'b'])
    expect(failureText('internal')).not.toContain('internal')
  })
})

describe('submitPolicy', () => {
  const req = { projectId: 'a', revision: '1', values: base() }
  const api = (r: unknown): WindowApi => ({ savePolicy: async () => r }) as unknown as WindowApi
  it('conflict, violations (server text hidden), error', async () => {
    expect(
      (await submitPolicy(api({ ok: false, code: 'conflict', message: 'x' }), req)).status.kind
    ).toBe('conflict')
    const v = await submitPolicy(
      api({
        ok: true,
        value: {
          saved: false,
          violations: [{ code: 'auto-needs-confirm', message: '/secret/path' }]
        }
      }),
      req
    )
    expect(JSON.stringify(v)).not.toContain('/secret/path')
    expect(v.status.kind).toBe('violations')
    expect(
      (await submitPolicy(api({ ok: false, code: 'internal', message: '/etc' }), req)).status
    ).toEqual({ kind: 'error', message: failureText('internal') })
  })
})

describe('project type wording (D-024)', () => {
  const JARGON = /PR|머지|푸시|브랜치|feature\/|master|main|reviewer-qa/
  const autoDraft = (): PolicyValues => ({
    ...base(),
    modes: { push: 'auto', merge: 'auto', publish: 'every', 'draft-approve': 'every' },
    dailyLimits: { push: 3, merge: 2 },
    autoPushPrefixes: ['work/'],
    autoMergeBranches: ['release'],
    confirmInput: 'x'
  })

  it('keeps development wording unchanged', () => {
    expect(describeAuto('merge', autoDraft())).toContain('머지')
    expect(
      policyBadge({ projectId: 'a', autoActions: ['push'], protectedMergeEnabled: true } as never)
        ?.label
    ).toContain('보호 브랜치')
    expect(violationText('protected-limit-exceeded')).toContain('보호 브랜치')
  })

  it.each(['content', 'other'] as const)('uses plain words for %s projects', (type) => {
    const texts = [
      describeAuto('push', autoDraft(), type),
      describeAuto('merge', autoDraft(), type),
      ...checkDraft({ ...autoDraft(), usePr: false, confirmInput: null }, 'p', type),
      ...immutableRules(type),
      policyBadge(
        { projectId: 'a', autoActions: ['push', 'merge'], protectedMergeEnabled: true } as never,
        type
      )?.label ?? '',
      ...Object.values(flowLabels(type)),
      ...Object.values(actionLabels(type))
    ]
    for (const code of [
      'auto-limit-exceeded',
      'auto-target-missing',
      'auto-target-invalid',
      'auto-requirement-missing',
      'protected-merge-unconfirmed',
      'protected-limit-exceeded'
    ] as const)
      texts.push(violationText(code, type))
    for (const code of [
      'auto-requirement-missing',
      'protected-limit-exceeded',
      'protected-merge-unconfirmed'
    ] as const)
      texts.push(warningText(code, type))
    for (const t of texts) expect(t).not.toMatch(JARGON)
  })

  it('keeps all approval modes and actions for every type', () => {
    for (const type of ['development', 'content', 'other'] as const)
      expect(Object.keys(actionLabels(type)).sort()).toEqual([...POLICY_ACTIONS].sort())
  })
})
