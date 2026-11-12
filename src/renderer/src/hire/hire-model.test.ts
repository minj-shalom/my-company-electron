import { describe, expect, it, vi } from 'vitest'
import type { OrgSnapshot } from '../../../shared/org'
import type { ChangeRecord } from '../../../shared/employee-change'
import {
  defaultSelection,
  describeFirstHire,
  existingRoles,
  hireErrorText,
  HR_ADD_REQUEST,
  loadFirstHire,
  needsFirstHire,
  needsHr,
  requestAvailability,
  rolesToHire,
  runFirstHire,
  runHrAdd
} from './hire-model'

const snap = (agentIds: string[], missing: OrgSnapshot['missingBaseRoles'] = []): OrgSnapshot => ({
  org: {
    members: agentIds.map((id) => ({
      title: id.toUpperCase(),
      kind: 'agent',
      agentId: id,
      fileExists: true,
      department: 'x',
      reportsTo: null,
      role: ''
    })),
    departments: [],
    tree: [],
    chart: [],
    issues: []
  },
  agents: [],
  missingBaseRoles: missing
})

const rec = (employeeId: string): ChangeRecord => ({
  action: 'create',
  employeeId,
  actor: 'ceo-ui',
  approval: null,
  sensitive: false,
  sensitiveReasons: [],
  changedFields: [],
  files: [],
  at: ''
})

const template = (id: string): never =>
  ({ id, title: id, department: '', role: '', description: `${id} 설명` }) as never

describe('loadFirstHire', () => {
  const api = (over: Record<string, unknown> = {}): Parameters<typeof loadFirstHire>[0] =>
    ({
      listEmployeeTemplates: async () => ({
        ok: true,
        value: [template('pm'), template('developer')]
      }),
      getOrg: async () => ({ ok: true, value: snap(['cto', 'cfo', 'hr']) }),
      detectProviders: async () => ({ ok: true, value: [{ provider: 'claude', state: 'ok' }] }),
      ...over
    }) as never

  it('puts pm first and marks existing roles', async () => {
    const r = await loadFirstHire(
      api({ getOrg: async () => ({ ok: true, value: snap(['developer']) }) })
    )
    expect(r.kind === 'ready' && r.cards.map((c) => [c.id, c.exists])).toEqual([
      ['pm', false],
      ['developer', true]
    ])
  })
  it('reports provider readiness, and null when detection fails', async () => {
    const ok = await loadFirstHire(api())
    expect(ok).toMatchObject({ providerReady: true })
    const none = await loadFirstHire(
      api({
        detectProviders: async () => ({
          ok: true,
          value: [{ provider: 'claude', state: 'not-installed' }]
        })
      })
    )
    expect(none).toMatchObject({ providerReady: false })
    const broken = await loadFirstHire(
      api({
        detectProviders: async () => {
          throw new Error('x')
        }
      })
    )
    expect(broken).toMatchObject({ kind: 'ready', providerReady: null })
  })
  it('turns failures and throws into one generic error', async () => {
    const failed = await loadFirstHire(
      api({ getOrg: async () => ({ ok: false, code: 'no-company', message: '/secret/path' }) })
    )
    expect(failed.kind).toBe('error')
    expect(JSON.stringify(failed)).not.toContain('/secret')
    const thrown = await loadFirstHire(
      api({
        listEmployeeTemplates: async () => {
          throw new Error('x')
        }
      })
    )
    expect(thrown.kind).toBe('error')
  })
})

describe('selection and availability', () => {
  const cards = [
    { id: 'pm', exists: false },
    { id: 'developer', exists: false }
  ] as never[]
  it('selects only pm by default and never hires existing roles', () => {
    expect([...defaultSelection(cards)]).toEqual(['pm'])
    expect(rolesToHire(cards, new Set(['developer', 'pm']))).toEqual(['pm', 'developer'])
    expect(rolesToHire([{ id: 'pm', exists: true }] as never[], new Set(['pm']))).toEqual([])
  })
  it('keeps the hr request disabled with a reason', () => {
    expect(requestAvailability(true).enabled).toBe(false)
    expect(requestAvailability(true).reason).toContain('준비')
    expect(requestAvailability(false).reason).toContain('제공자')
  })
})

describe('org checks', () => {
  it('detects roles by agent id', () => {
    expect([...existingRoles(snap(['pm', 'cto']))]).toEqual(['pm'])
    expect(needsFirstHire(snap(['cto', 'cfo', 'hr']))).toBe(true)
    expect(needsFirstHire(snap(['pm']))).toBe(false)
    expect(needsHr(snap(['cto'], ['hr']))).toBe(true)
    expect(needsHr(snap(['cto']))).toBe(false)
  })
})

describe('hire actions', () => {
  it('describes hired and skipped roles', () => {
    const out = describeFirstHire({ records: [rec('pm')], skipped: ['developer'] })
    expect(out).toMatchObject({ kind: 'done', hired: ['pm'], skipped: ['developer'] })
    expect(out.kind === 'done' && out.message).toContain('PM')
    expect(out.kind === 'done' && out.message).toContain('건너뛰었어요')
  })
  it('maps error codes to fixed text and ignores unknown codes', () => {
    expect(hireErrorText('approval-required')).toContain('승인')
    expect(hireErrorText('conflict')).toContain('이미')
    expect(hireErrorText('toString')).toContain('채용하지 못했어요')
    expect(hireErrorText(undefined)).toContain('바뀐 것은 없어요')
  })
  it('passes the requested roles and handles failure and throw', async () => {
    const firstHire = vi.fn(async () => ({
      ok: true as const,
      value: { records: [rec('pm')], skipped: [] }
    }))
    expect(await runFirstHire({ firstHire }, ['pm'])).toMatchObject({ kind: 'done' })
    expect(firstHire).toHaveBeenCalledWith({ roles: ['pm'] })
    const failed = await runFirstHire(
      { firstHire: async () => ({ ok: false, code: 'conflict', message: '/x' }) },
      ['pm']
    )
    expect(failed).toMatchObject({ kind: 'error' })
    const thrown = await runFirstHire(
      {
        firstHire: async () => {
          throw new Error('/x')
        }
      },
      ['pm']
    )
    expect(JSON.stringify(thrown)).not.toContain('/x')
  })
  it('adds hr with the fixed template, department and report line', async () => {
    const createEmployee = vi.fn(async () => ({
      ok: true as const,
      value: { record: rec('hr'), warnings: [] }
    }))
    expect(await runHrAdd({ createEmployee })).toMatchObject({ kind: 'done' })
    expect(createEmployee).toHaveBeenCalledWith(HR_ADD_REQUEST)
    expect(HR_ADD_REQUEST).toEqual({
      templateId: 'hr',
      id: 'hr',
      department: '인사팀',
      reportsTo: 'COO'
    })
    const needs = await runHrAdd({
      createEmployee: async () => ({ ok: false, code: 'approval-required', message: 'x' })
    })
    expect(needs).toMatchObject({ kind: 'error' })
    expect(needs.kind === 'error' && needs.message).toContain('승인')
  })
})
