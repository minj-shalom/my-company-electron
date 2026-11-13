import { describe, expect, it } from 'vitest'
import type { ProviderUsageView, UsageTotals } from '../../../shared/usage'
import {
  attributionMissing,
  breakdownRows,
  effectiveProvider,
  parseKrwPerUsd,
  parseWarnPercent,
  setDefaultProvider,
  setEmployeeProvider,
  toDrafts,
  usageRow
} from './settings-model'
import { parseLimitInput } from '../onboarding/weekly-limit'

const totals = (over: Partial<UsageTotals> = {}): UsageTotals => ({
  requests: 3,
  inputTokens: 10,
  outputTokens: 5,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  costUsd: 10,
  ...over
})
const view = (over: Partial<ProviderUsageView> = {}): ProviderUsageView => ({
  provider: 'claude',
  totals: totals(),
  unit: 'usd',
  limitAmount: 20,
  percent: 50,
  estimated: false,
  costKrw: 14000,
  status: 'ok',
  ...over
})

describe('input parsing', () => {
  it('rejects token-like and non-numeric input', () => {
    for (const bad of ['sk-ant-api03-abcdef', 'abc', '80%', '', '0', '101', '1.5', '-3']) {
      expect(parseWarnPercent(bad).ok).toBe(false)
    }
    for (const bad of ['sk-proj-123', 'ghp_xxxxxxxx', '0', '100001', '1e3']) {
      expect(parseKrwPerUsd(bad).ok).toBe(false)
      expect(parseLimitInput(bad).ok && parseLimitInput(bad)).toBeFalsy()
    }
  })
  it('accepts valid values', () => {
    expect(parseWarnPercent(' 80 ')).toEqual({ ok: true, value: 80 })
    expect(parseKrwPerUsd('1,400')).toEqual({ ok: true, value: 1400 })
  })
})

describe('toDrafts', () => {
  it('defaults providers without a limit to subscription and empty', () => {
    const d = toDrafts([{ provider: 'codex', amount: 25, unit: 'usd' }])
    expect(d.claude).toEqual({ unit: 'subscription-percent', text: '' })
    expect(d.codex).toEqual({ unit: 'usd', text: '25' })
  })
})

describe('usageRow', () => {
  it('shows percent and KRW for pay-as-you-go', () => {
    const r = usageRow(view(), 1400)
    expect(r.percentText).toBe('50%')
    expect(r.costText).toBe('$10.00 (14,000원)')
    expect(r.barPercent).toBe(50)
  })
  it('marks subscription percent as an estimate', () => {
    const r = usageRow(view({ unit: 'subscription-percent', estimated: true, costKrw: null }), 1400)
    expect(r.percentText).toBe('50% (추정)')
    expect(r.note).toContain('추정')
  })
  it('handles warn, exceeded, unknown and no-limit', () => {
    expect(usageRow(view({ status: 'warn', percent: 85 }), 1400).tone).toBe('warn')
    const ex = usageRow(view({ status: 'exceeded', percent: 140 }), 1400)
    expect(ex.tone).toBe('bad')
    expect(ex.barPercent).toBe(100)
    const unk = usageRow(
      view({ status: 'unknown', percent: null, totals: totals({ costUsd: null }) }),
      1400
    )
    expect(unk.percentText).toBe('알 수 없음')
    expect(unk.costText).toBe('알 수 없음')
    expect(unk.barPercent).toBeNull()
    const none = usageRow(view({ status: 'no-limit', percent: null, unit: null }), 1400)
    expect(none.percentText).toBe('한도 미설정')
    expect(none.note).toContain('한도')
  })
})

describe('breakdownRows', () => {
  const names = {
    projectNames: new Map([['a', '앱']]),
    employeeNames: new Map([['dev', '개발자']]),
    employeeProjects: new Map([['dev', ['앱', '블로그']]])
  }
  it('labels null keys, resolves names and never estimates a missing cost', () => {
    const total = totals({ costUsd: 20 })
    const proj = breakdownRows(
      'project',
      [
        { key: null, totals: totals({ costUsd: 5 }) },
        { key: 'a', totals: totals({ costUsd: 10 }) },
        { key: 'x', totals: totals({ costUsd: null }) }
      ],
      total,
      names
    )
    expect(proj.map((r) => r.label)).toEqual(['앱', '회사 공통', 'x'])
    expect(proj[0].ratioText).toBe('50%')
    expect(proj[2].ratioText).toBe('알 수 없음')
    expect(proj[2].costText).toBe('알 수 없음')
    const emp = breakdownRows(
      'employee',
      [
        { key: 'dev', totals: totals() },
        { key: null, totals: totals() }
      ],
      total,
      names
    )
    expect(emp[0].projects).toBe('앱, 블로그')
    expect(emp[1].label).toBe('미분류')
    expect(emp[1].projects).toBe('알 수 없음')
  })
  it('flags missing attribution only when there is usage but no breakdown', () => {
    expect(attributionMissing([], totals())).toBe(true)
    expect(attributionMissing([], totals({ requests: 0 }))).toBe(false)
    expect(attributionMissing([{ key: null, totals: totals() }], totals())).toBe(false)
  })
})

describe('provider selection helpers', () => {
  const makeApi = (): {
    api: Parameters<typeof setEmployeeProvider>[0]
    saved: unknown[]
  } => {
    let cur = { defaultProvider: 'claude' as const, overrides: { pm: 'gemini' as const } }
    const saved: unknown[] = []
    return {
      saved,
      api: {
        getProviderSelection: async () => ({ ok: true, value: structuredClone(cur) }),
        saveProviderSelection: async (req) => {
          saved.push(req)
          cur = req as typeof cur
          return { ok: true, value: req }
        }
      }
    }
  }
  it('adds and removes an employee override without touching others', async () => {
    const { api, saved } = makeApi()
    await setEmployeeProvider(api, 'dev', 'codex')
    expect(saved[0]).toEqual({
      defaultProvider: 'claude',
      overrides: { pm: 'gemini', dev: 'codex' }
    })
    await setEmployeeProvider(api, 'pm', null)
    expect(saved[1]).toEqual({ defaultProvider: 'claude', overrides: { dev: 'codex' } })
  })
  it('changes the default and resolves the effective provider', async () => {
    const { api } = makeApi()
    const r = await setDefaultProvider(api, 'codex')
    expect(r.ok && r.value.defaultProvider).toBe('codex')
    if (r.ok) {
      expect(effectiveProvider(r.value, 'pm')).toBe('gemini')
      expect(effectiveProvider(r.value, 'other')).toBe('codex')
    }
  })
  it('reports failure when the API fails or throws', async () => {
    const failing = {
      getProviderSelection: async () => ({
        ok: false as const,
        code: 'internal' as const,
        message: ''
      }),
      saveProviderSelection: async () => {
        throw new Error('x')
      }
    }
    expect((await setDefaultProvider(failing, 'codex')).ok).toBe(false)
    const throwing = {
      ...failing,
      getProviderSelection: async () => {
        throw new Error('x')
      }
    }
    expect((await setEmployeeProvider(throwing, 'a', null)).ok).toBe(false)
  })
})
