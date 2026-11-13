import { mkdir, mkdtemp, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SafeFs } from '../repository/safe-fs'
import { createDecisionNotifier } from './decision-notifier'
import { VisitService } from './visit-service'
import { createVisitStore } from './visit-store'

const T0 = new Date('2026-11-14T00:00:00Z')
const NOW = new Date('2026-11-14T12:00:00Z')

async function setup(): Promise<{
  root: string
  svc: VisitService
  store: ReturnType<typeof createVisitStore>
  fs: SafeFs
}> {
  const root = await mkdtemp(join(tmpdir(), 'mc-visit-'))
  const ud = await mkdtemp(join(tmpdir(), 'mc-visit-ud-'))
  const fs = await SafeFs.open(root)
  const store = createVisitStore(ud)
  const svc = new VisitService({ fs, companyTag: 'c1', store, now: () => NOW })
  return { root: fs.root, svc, store, fs }
}

async function put(root: string, rel: string, text: string, at: Date): Promise<void> {
  const abs = join(root, rel)
  await mkdir(join(abs, '..'), { recursive: true })
  await writeFile(abs, text, 'utf8')
  await utimes(abs, at, at)
}

describe('visit summary', () => {
  it('first visit returns empty lists and sets the baseline', async () => {
    const { svc, store } = await setup()
    const s = await svc.summary()
    expect(s).toMatchObject({ firstVisit: true, since: null, reports: [], failedTicks: 0 })
    expect((await store.load('c1')).lastVisitAt).toBe(NOW.getTime())
  })

  it('handles no reports at all', async () => {
    const { svc, store } = await setup()
    await store.save('c1', { lastVisitAt: T0.getTime(), notified: [] })
    const s = await svc.summary()
    expect(s).toMatchObject({
      firstVisit: false,
      reports: [],
      completedTickets: [],
      newDecisions: [],
      failedTicks: 0
    })
  })

  it('includes only files modified strictly after the last visit', async () => {
    const { root, svc, store } = await setup()
    await store.save('c1', { lastVisitAt: T0.getTime(), notified: [] })
    const after = new Date(T0.getTime() + 1000)
    await put(root, 'company/tickets/done/T-001-old.md', '# T-001: 옛 티켓\n', T0)
    await put(
      root,
      'company/tickets/done/T-002-new.md',
      '# T-002: 새 티켓\n- **프로젝트:** my-company\n',
      after
    )
    await put(
      root,
      'company/tickets/done/T-003-other.md',
      '# T-003: 다른\n- **프로젝트:** other\n',
      after
    )
    await put(root, 'company/decisions/pending/D-001-a.md', '# D-001: 옛 카드\n', T0)
    await put(root, 'company/decisions/pending/D-002-b.md', '# D-002: 새 카드\n', after)
    await put(
      root,
      'company/reports/briefing-20261114060000.md',
      '# 브리핑\n- **결과:** 실패\n',
      after
    )
    await put(
      root,
      'company/reports/briefing-20261114070000.md',
      '# 브리핑2\n- **결과:** 완료\n',
      after
    )
    await put(root, 'company/reports/T-002-report.md', '# 보고서\n', after)
    const s = await svc.summary()
    expect(s.completedTickets.map((t) => t.id).sort()).toEqual(['T-002', 'T-003'])
    expect(s.completedTickets.find((t) => t.id === 'T-002')?.projectId).toBe('my-company')
    expect(s.newDecisions).toEqual([{ id: 'D-002', title: '새 카드', projectId: null }])
    expect(s.reports).toHaveLength(2)
    expect(s.failedTicks).toBe(1)
    const filtered = await svc.summary({ projectId: 'my-company' })
    expect(filtered.completedTickets.map((t) => t.id)).toEqual(['T-002'])
  })

  it('markSeen moves the boundary', async () => {
    const { root, svc, store } = await setup()
    await store.save('c1', { lastVisitAt: T0.getTime(), notified: [] })
    await put(
      root,
      'company/decisions/pending/D-002-b.md',
      '# D-002: x\n',
      new Date(T0.getTime() + 1000)
    )
    expect((await svc.summary()).newDecisions).toHaveLength(1)
    await svc.markSeen()
    expect((await svc.summary()).newDecisions).toHaveLength(0)
  })

  it('does not follow symlinked files outside the company folder', async () => {
    const { root, svc, store, fs } = await setup()
    await store.save('c1', { lastVisitAt: T0.getTime(), notified: [] })
    await mkdir(join(root, 'company/decisions/pending'), { recursive: true })
    const outside = await mkdtemp(join(tmpdir(), 'mc-out-'))
    await writeFile(join(outside, 'D-009-x.md'), '# D-009: 밖\n')
    const { symlink } = await import('node:fs/promises')
    await symlink(join(outside, 'D-009-x.md'), join(root, 'company/decisions/pending/D-009-x.md'))
    expect((await svc.summary()).newDecisions).toEqual([])
    await expect(fs.mtimeMs('../x')).rejects.toThrow()
  })
})

describe('decision notifier', () => {
  it('notifies once per card, count only, and respects window focus and setting', async () => {
    const { root, svc, store } = await setup()
    await store.save('c1', { lastVisitAt: T0.getTime(), notified: [] })
    await put(
      root,
      'company/decisions/pending/D-002-비밀.md',
      '# D-002: 비밀 제목 /secret/path\n',
      new Date(T0.getTime() + 1000)
    )
    const shown: Array<[string, string]> = []
    let active = true
    let enabled = true
    const n = createDecisionNotifier({
      isEnabled: async () => enabled,
      isWindowActive: () => active,
      takeUnnotified: () => svc.takeUnnotified(),
      show: (t, b) => shown.push([t, b])
    })
    expect(await n.check()).toBe(0) // 창 활성
    active = false
    enabled = false
    expect(await n.check()).toBe(0) // 설정 꺼짐
    enabled = true
    expect(await n.check()).toBe(1)
    expect(await n.check()).toBe(0) // 중복 방지
    expect(shown).toHaveLength(1)
    expect(shown[0].join(' ')).not.toMatch(/비밀|secret|D-002/)
    await put(
      root,
      'company/decisions/pending/D-003-c.md',
      '# D-003: y\n',
      new Date(T0.getTime() + 2000)
    )
    expect(await n.check()).toBe(1)
  })

  it('does not notify existing cards on the first check', async () => {
    const { root, svc } = await setup()
    await put(root, 'company/decisions/pending/D-002-b.md', '# D-002: x\n', T0)
    expect(await svc.takeUnnotified()).toEqual([])
  })

  it('persists notified ids across service instances', async () => {
    const { root, svc, store } = await setup()
    await store.save('c1', { lastVisitAt: T0.getTime(), notified: [] })
    await put(
      root,
      'company/decisions/pending/D-002-b.md',
      '# D-002: x\n',
      new Date(T0.getTime() + 1000)
    )
    expect(await svc.takeUnnotified()).toHaveLength(1)
    expect(await svc.takeUnnotified()).toHaveLength(0)
  })
})
