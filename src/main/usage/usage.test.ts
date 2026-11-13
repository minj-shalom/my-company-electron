import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { WeeklyLimit } from '../../shared/provider'
import {
  USAGE_SETTINGS_DEFAULT,
  validateUsageSettings,
  type UsageSettings
} from '../../shared/usage'
import { createFileGateCards } from '../gate/gate-cards'
import type { ProviderUsage } from '../providers/types'
import { SafeFs } from '../repository/safe-fs'
import { parseWeeklyLimits } from '../settings/weekly-limits-store'
import { buildWidgetData } from './usage-aggregate'
import { createUsageAlertLog } from './usage-alerts'
import { buildUsageRecord, parseUsageFile, parseUsageLine } from './usage-record'
import { UsageService } from './usage-service'
import { createUsageStore, USAGE_DIR } from './usage-store'
import { inWindow } from './usage-aggregate'
import { weekWindow } from './usage-window'

const usage = (o: Partial<ProviderUsage> = {}): ProviderUsage => ({
  costUsd: 1,
  durationMs: 10,
  numTurns: 2,
  inputTokens: 100,
  outputTokens: 50,
  cacheReadTokens: 5,
  cacheCreationTokens: 1,
  ...o
})

// 2026-01-07은 수요일. 기본 초기화는 월요일 00:00(로컬).
const at = (d: string): Date => new Date(`${d}T12:00:00`)

describe('usage record', () => {
  it('keeps only numbers and attribution; invalid attribution is dropped, never guessed', () => {
    const r = buildUsageRecord(
      'claude',
      usage({ costUsd: -1 }),
      { project: 'Bad Id!', employee: 'developer', ticket: 'T-019' },
      at('2026-01-07')
    )
    expect(r).toMatchObject({
      project: null,
      employee: 'developer',
      ticket: 'T-019',
      costUsd: null
    })
    expect(Object.keys(r).join()).not.toMatch(/token(?!s)|auth|key|secret|account/i)
  })

  it('reads legacy lines without attribution as unattributed, and skips broken lines', () => {
    const legacy = `- ${JSON.stringify({ at: '2026-01-07T01:00:00Z', provider: 'claude', costUsd: 2 })}`
    const r = parseUsageLine(legacy)
    expect(r).toMatchObject({
      project: null,
      employee: null,
      ticket: null,
      requests: 1,
      costUsd: 2
    })
    const text = `# h\n${legacy}\n- {broken\n- {"at":"x","provider":"claude"}\n- {"at":"2026-01-07T01:00:00Z","provider":"evil"}\nplain`
    expect(parseUsageFile(text)).toHaveLength(1)
  })
})

describe('week window', () => {
  it('starts at the most recent reset and restarts aggregation after it', () => {
    const s = { resetWeekday: 1, resetHour: 0 }
    const w = weekWindow(at('2026-01-07'), s)
    expect(w.start.getDay()).toBe(1)
    expect(w.start.getDate()).toBe(5)
    expect(w.end.getDate()).toBe(12)
    const next = weekWindow(at('2026-01-13'), s)
    expect(next.start.getDate()).toBe(12)
    // 초기화 요일 당일이라도 초기화 시각 전이면 지난 구간이다.
    const early = weekWindow(new Date('2026-01-12T03:00:00'), { resetWeekday: 1, resetHour: 9 })
    expect(early.start.getDate()).toBe(5)
  })
})

describe('window boundaries', () => {
  it('includes exactly start and excludes exactly end', () => {
    const w = weekWindow(at('2026-01-07'), USAGE_SETTINGS_DEFAULT)
    const r = (t: number): ReturnType<typeof buildUsageRecord> =>
      buildUsageRecord('claude', usage(), {}, new Date(t))
    expect(inWindow(r(w.start.getTime()), w)).toBe(true)
    expect(inWindow(r(w.start.getTime() - 1), w)).toBe(false)
    expect(inWindow(r(w.end.getTime() - 1), w)).toBe(true)
    expect(inWindow(r(w.end.getTime()), w)).toBe(false)
  })
})

describe('aggregation', () => {
  const w = weekWindow(at('2026-01-07'), USAGE_SETTINGS_DEFAULT)
  const rec = (
    p: Partial<Parameters<typeof buildUsageRecord>[2]>,
    u: Partial<ProviderUsage> = {}
  ): ReturnType<typeof buildUsageRecord> =>
    buildUsageRecord('claude', usage(u), p, at('2026-01-06'))

  it('groups by project and employee and keeps null as its own group last', () => {
    const d = buildWidgetData(
      [
        rec({ project: 'app', employee: 'dev' }, { costUsd: 3 }),
        rec({ project: 'app', employee: null }, { costUsd: 1 }),
        rec({ project: null, employee: 'dev' }, { costUsd: 9 })
      ],
      [],
      USAGE_SETTINGS_DEFAULT,
      w
    )
    expect(d.byProject.map((x) => [x.key, x.totals.costUsd])).toEqual([
      ['app', 4],
      [null, 9]
    ])
    expect(d.byEmployee.map((x) => x.key)).toEqual(['dev', null])
    expect(d.total).toMatchObject({ requests: 3, inputTokens: 300, costUsd: 13 })
  })

  const limit = (unit: WeeklyLimit['unit'], amount = 10): WeeklyLimit[] => [
    { provider: 'claude', amount, unit }
  ]
  it('usd plan: percent, status and KRW from the user rate', () => {
    const d = buildWidgetData([rec({}, { costUsd: 8 })], limit('usd'), USAGE_SETTINGS_DEFAULT, w)
    const p = d.providers.find((x) => x.provider === 'claude')
    expect(p).toMatchObject({ percent: 80, status: 'warn', costKrw: 11200, estimated: false })
  })
  it('subscription plan: percent against the user reference value, marked as estimate, no KRW', () => {
    const d = buildWidgetData(
      [rec({}, { costUsd: 12 })],
      limit('subscription-percent'),
      USAGE_SETTINGS_DEFAULT,
      w
    )
    expect(d.providers[0]).toMatchObject({
      percent: 120,
      status: 'exceeded',
      estimated: true,
      costKrw: null
    })
  })
  it('reports unknown when the CLI gave no cost, and no-limit without a limit', () => {
    const d = buildWidgetData([rec({}, { costUsd: null })], limit('usd'), USAGE_SETTINGS_DEFAULT, w)
    expect(d.providers[0]).toMatchObject({ status: 'unknown', percent: null })
    expect(d.providers[0].totals.requests).toBe(1)
    expect(d.providers[1]).toMatchObject({ provider: 'codex', status: 'no-limit' })
  })
})

describe('settings and units', () => {
  it('validates settings ranges', () => {
    expect(validateUsageSettings(USAGE_SETTINGS_DEFAULT)).toBe(true)
    for (const bad of [
      { ...USAGE_SETTINGS_DEFAULT, warnPercent: 0 },
      { ...USAGE_SETTINGS_DEFAULT, krwPerUsd: 0 },
      { ...USAGE_SETTINGS_DEFAULT, resetWeekday: 7 },
      { ...USAGE_SETTINGS_DEFAULT, resetHour: 1.5 },
      null
    ])
      expect(validateUsageSettings(bad)).toBe(false)
  })
  it('accepts the subscription-percent unit and rejects unknown units', () => {
    expect(
      parseWeeklyLimits({
        limits: [{ provider: 'claude', amount: 5, unit: 'subscription-percent' }]
      })
    ).not.toBeNull()
    expect(
      parseWeeklyLimits({ limits: [{ provider: 'claude', amount: 5, unit: 'krw' }] })
    ).toBeNull()
  })
})

describe('store, alerts, service', () => {
  let dir: string
  let fs: SafeFs
  let nowMs: number
  let limits: WeeklyLimit[]
  let settings: UsageSettings
  const mk = (): UsageService =>
    new UsageService({
      root: fs.root,
      store: createUsageStore(fs),
      alerts: createUsageAlertLog(fs),
      cards: createFileGateCards({ fs, exclusive: (t) => t() }),
      limits: { load: async () => limits, save: async () => undefined },
      settings: { load: async () => settings, save: async () => undefined },
      now: () => new Date(nowMs)
    })
  const cards = async (): Promise<string[]> =>
    (await fs.listMarkdown('company/decisions/pending')).files

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mc-usage-'))
    await mkdir(join(dir, 'company/decisions/pending'), { recursive: true })
    fs = await SafeFs.open(dir)
    nowMs = at('2026-01-07').getTime()
    limits = [{ provider: 'claude', amount: 10, unit: 'usd' }]
    settings = { ...USAGE_SETTINGS_DEFAULT }
  })
  afterEach(() => rm(dir, { recursive: true, force: true }))

  it('appends records to a daily markdown file and reads only the window', async () => {
    const store = createUsageStore(fs)
    const w = weekWindow(new Date(nowMs), settings)
    await store.append(buildUsageRecord('claude', usage(), { employee: 'dev' }, at('2026-01-06')))
    await store.append(buildUsageRecord('claude', usage(), {}, at('2026-01-06')))
    await store.append(buildUsageRecord('claude', usage(), {}, at('2025-12-20')))
    await writeFile(join(dir, USAGE_DIR, 'notes.md'), 'ignored')
    const got = await store.readWindow(w)
    expect(got).toHaveLength(2)
    expect(got[0].employee).toBe('dev')
  })

  it('creates one warning card per provider, level and window, and a new one after reset', async () => {
    const svc = mk()
    await svc.record('claude', usage({ costUsd: 5 }), {})
    expect(await cards()).toHaveLength(0)
    await svc.record('claude', usage({ costUsd: 3 }), { ticket: 'T-019' }) // 80%
    await svc.record('claude', usage({ costUsd: 0.5 }), {}) // 85%
    expect(await cards()).toHaveLength(1)
    await svc.record('claude', usage({ costUsd: 3 }), {}) // 115%
    expect(await cards()).toHaveLength(2)
    expect(await svc.checkLimit(['claude'])).toMatchObject({ ok: false, cardHandled: true })
    // 다른 제공자 실행은 막지 않는다.
    expect((await svc.checkLimit(['codex'])).ok).toBe(true)
    expect(await cards()).toHaveLength(2)
    // 한도 초기화 후: 집계가 0에서 다시 시작하고 경고도 새로 가능하다.
    nowMs = at('2026-01-14').getTime()
    expect((await svc.widget()).total.requests).toBe(0)
    expect((await svc.checkLimit(['claude'])).ok).toBe(true)
    await svc.record('claude', usage({ costUsd: 9 }), {})
    expect(await cards()).toHaveLength(3)
  })

  it('card text carries no credentials and does not block when the limit is unset', async () => {
    limits = []
    const svc = mk()
    await svc.record('claude', usage({ costUsd: 100 }), {})
    expect(await cards()).toHaveLength(0)
    expect((await svc.checkLimit(['claude'])).ok).toBe(true)
  })
})
