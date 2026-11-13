import { describe, expect, it } from 'vitest'
import type { WeeklyLimit } from '../../shared/provider'
import { createMockUsageApi, parseUsageScenario } from './mock-usage'

const make = (
  s: Parameters<typeof createMockUsageApi>[0]
): ReturnType<typeof createMockUsageApi> => {
  let limits: WeeklyLimit[] = []
  return createMockUsageApi(s, 0, {
    get: async () => ({ ok: true, value: limits }),
    seed: (l) => {
      limits = l
    }
  })
}

describe('mock usage api', () => {
  it('default is empty with no limits', async () => {
    const r = await make('default').api.getUsageWidget()
    expect(r.ok && r.value.providers).toEqual([])
    expect(r.ok && r.value.byEmployee).toEqual([])
  })
  it('ok scenario has 3 projects (plus common) and 6+ employees', async () => {
    const r = await make('ok').api.getUsageWidget()
    if (!r.ok) throw new Error('expected ok')
    expect(r.value.byProject.filter((p) => p.key !== null).length).toBe(3)
    expect(r.value.byEmployee.filter((e) => e.key !== null).length).toBeGreaterThanOrEqual(6)
    const statuses = Object.fromEntries(r.value.providers.map((p) => [p.provider, p.status]))
    expect(statuses).toEqual({ claude: 'ok', codex: 'ok', gemini: 'unknown' })
    expect(r.value.providers.find((p) => p.provider === 'gemini')?.totals.costUsd).toBeNull()
  })
  it('warn scenario exceeds the limit and passes the warn threshold', async () => {
    const r = await make('warn').api.getUsageWidget()
    if (!r.ok) throw new Error('expected ok')
    const by = Object.fromEntries(r.value.providers.map((p) => [p.provider, p.status]))
    expect(by.claude).toBe('exceeded')
    expect(by.codex).toBe('warn')
  })
  it('validates and stores usage settings and provider selection', async () => {
    const { api } = make('ok')
    const bad = await api.saveUsageSettings({
      warnPercent: 0,
      krwPerUsd: 1400,
      resetWeekday: 1,
      resetHour: 0
    })
    expect(bad.ok).toBe(false)
    await api.saveUsageSettings({ warnPercent: 50, krwPerUsd: 1300, resetWeekday: 3, resetHour: 9 })
    const w = await api.getUsageWidget()
    expect(w.ok && w.value.settings.warnPercent).toBe(50)
    const badSel = await api.saveProviderSelection({
      defaultProvider: 'claude',
      overrides: { pm: 'evil' as never }
    })
    expect(badSel.ok).toBe(false)
    const okSel = await api.saveProviderSelection({
      defaultProvider: 'codex',
      overrides: { pm: 'gemini' }
    })
    expect(okSel.ok && okSel.value.defaultProvider).toBe('codex')
  })
  it('error scenario fails and parse falls back to default', async () => {
    expect((await make('error').api.getUsageWidget()).ok).toBe(false)
    expect(parseUsageScenario('?mock-usage=warn')).toBe('warn')
    expect(parseUsageScenario('?mock-usage=x')).toBe('default')
  })
})
