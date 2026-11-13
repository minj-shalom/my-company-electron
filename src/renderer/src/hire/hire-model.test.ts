import { describe, expect, it, vi } from 'vitest'
import type { OrgSnapshot } from '../../../shared/org'
import type { ChangeRecord } from '../../../shared/employee-change'
import {
  addHrOnce,
  defaultSelection,
  describeFirstHire,
  existingRoles,
  hireErrorText,
  HR_ADD_REQUEST,
  loadFirstHire,
  needsFirstHire,
  needsHr,
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
    expect(hireErrorText('approval-required')).toContain('COO에게 요청')
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
    expect(needs.kind === 'error' && needs.message).toContain('COO에게 요청')
  })
})

describe('title based role detection', () => {
  const withTitle = (title: string, agentId: string): OrgSnapshot => {
    const s = snap([agentId])
    s.org.members[0].title = title
    return s
  }
  it('treats a PM title with another agent id as existing (main normalizes titles)', () => {
    expect([...existingRoles(withTitle('PM', 'planner'))]).toEqual(['pm'])
    expect([...existingRoles(withTitle(' pm ', 'planner'))]).toEqual(['pm'])
    expect([...existingRoles(withTitle('개발자', 'coder'))]).toEqual(['developer'])
    expect(needsFirstHire(withTitle('PM', 'planner'))).toBe(false)
    expect([...existingRoles(withTitle('기획자', 'planner'))]).toEqual([])
  })
  it('marks the card as existing in loadFirstHire', async () => {
    const r = await loadFirstHire({
      listEmployeeTemplates: async () => ({ ok: true, value: [] }),
      getOrg: async () => ({ ok: true, value: withTitle('PM', 'planner') }),
      detectProviders: async () => ({ ok: true, value: [] })
    } as never)
    expect(r.kind === 'ready' && r.cards.map((c) => c.exists)).toEqual([true, false])
  })
})

describe('addHrOnce', () => {
  it('calls createEmployee once for rapid repeated clicks', async () => {
    let calls = 0
    let release: () => void = () => {}
    const api = {
      createEmployee: () => {
        calls += 1
        return new Promise<never>((r) => {
          release = () => r({ ok: true, value: { record: rec('hr'), warnings: [] } } as never)
        })
      }
    }
    const lock = { current: false }
    const first = addHrOnce(lock, api)
    const second = await addHrOnce(lock, api)
    expect(second).toBeNull()
    await Promise.resolve()
    release()
    expect(await first).toMatchObject({ kind: 'done' })
    expect(calls).toBe(1)
    // 끝난 뒤에는 다시 누를 수 있다.
    const third = addHrOnce(lock, api)
    await Promise.resolve()
    release()
    await third
    expect(calls).toBe(2)
  })
  it('does not call the api until invoked and maps conflict and approval codes', async () => {
    let calls = 0
    const mk = (code: 'conflict' | 'approval-required'): Parameters<typeof addHrOnce>[1] => ({
      createEmployee: async () => {
        calls += 1
        return { ok: false as const, code, message: '/secret' }
      }
    })
    expect(calls).toBe(0)
    const c = await addHrOnce({ current: false }, mk('conflict'))
    const a = await addHrOnce({ current: false }, mk('approval-required'))
    expect(calls).toBe(2)
    expect(c).toMatchObject({ kind: 'error' })
    expect(c?.kind === 'error' && c.message).toContain('이미')
    expect(a?.kind === 'error' && a.message).toContain('COO에게 요청')
    expect(JSON.stringify([c, a])).not.toContain('/secret')
  })
})
