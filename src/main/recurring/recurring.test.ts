import { readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ProjectInfo } from '../../shared/project'
import type { RecurringDefinition } from '../../shared/recurring'
import { makeCompany } from '../employee/test-company'
import type { PolicyHoursEntry } from '../scheduler/scheduler'
import { TicketService } from '../ticket/ticket-service'
import { parseRecurring, serializeRecurring } from './recurring-doc'
import { dayOf, matchesCadence, nextRunAt, renderTemplate } from './recurring-schedule'
import { RecurringService } from './recurring-service'

const dirs: string[] = []
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
})

const proj = (id: string, over: Partial<ProjectInfo> = {}): ProjectInfo =>
  ({
    id,
    name: id,
    status: 'active',
    pmId: 'pm',
    state: 'ready',
    memberIds: [],
    ...over
  }) as ProjectInfo

const def = (over: Partial<RecurringDefinition> = {}): RecurringDefinition => ({
  id: 'blog',
  projectId: 'web',
  titleTemplate: 'Blog post {date}',
  goalTemplate: '오늘 글을 쓴다.',
  criteriaTemplates: ['초안 작성'],
  cadence: 'daily',
  count: 1,
  assignee: null,
  status: 'active',
  ...over
})

// 2026-11-13 은 금요일. UTC 15:00 = 서울 다음 날 00:00.
const FRI_NOON_UTC = new Date('2026-11-13T12:00:00Z')

interface Setup {
  c: Awaited<ReturnType<typeof makeCompany>>
  svc: RecurringService
  clock: { now: Date; tz: string }
  backlog: () => Promise<string[]>
  readBacklog: (name: string) => Promise<string>
}

async function setup(
  o: {
    projects?: ProjectInfo[]
    hours?: PolicyHoursEntry[]
    now?: Date
    tz?: string
  } = {}
): Promise<Setup> {
  const c = await makeCompany()
  dirs.push(c.dir)
  const clock = { now: o.now ?? FRI_NOON_UTC, tz: o.tz ?? 'UTC' }
  const projects = o.projects ?? [
    proj('web'),
    proj('old', { status: 'archived', state: 'archived' }),
    proj('nopm', { pmId: null, state: 'pm-required' }),
    proj('team', { memberIds: ['developer'] })
  ]
  const tickets = new TicketService({
    fs: c.fs,
    exclusive: (t) => c.repo.runExclusive(t),
    employeeIds: async () => new Set((await c.repo.listEmployees()).org.employees.map((e) => e.id)),
    projects: async () => projects,
    getTicket: (id) => c.repo.getTicket(id)
  })
  const svc = new RecurringService({
    fs: c.fs,
    exclusive: (t) => c.repo.runExclusive(t),
    tickets,
    projects: async () => projects,
    employeeIds: async () => new Set((await c.repo.listEmployees()).org.employees.map((e) => e.id)),
    loadPolicyHours: async () => o.hours ?? [],
    clock: { now: () => clock.now, timeZone: clock.tz }
  })
  return {
    c,
    svc,
    clock,
    backlog: () => readdir(join(c.dir, 'company/tickets/backlog')).catch(() => [] as string[]),
    readBacklog: async (name: string) =>
      readFile(join(c.dir, 'company/tickets/backlog', name), 'utf8')
  }
}

describe('schedule helpers', () => {
  it('weekday/date follow the injected time zone at the midnight boundary', () => {
    const at = new Date('2026-11-13T15:00:00Z')
    expect(dayOf(at, 'UTC')).toEqual({ date: '2026-11-13', weekday: 5 })
    expect(dayOf(at, 'Asia/Seoul')).toEqual({ date: '2026-11-14', weekday: 6 })
    expect(dayOf(new Date('2026-11-13T14:59:59Z'), 'Asia/Seoul').date).toBe('2026-11-13')
    expect(dayOf(new Date('2026-11-13T07:59:59Z'), 'America/Los_Angeles').date).toBe('2026-11-12')
  })

  it('matches cadences', () => {
    expect(matchesCadence('daily', 0)).toBe(true)
    expect(matchesCadence('weekdays', 5)).toBe(true)
    expect(matchesCadence('weekdays', 6)).toBe(false)
    expect(matchesCadence('weekdays', 0)).toBe(false)
    expect(matchesCadence('weekly:월', 1)).toBe(true)
    expect(matchesCadence('weekly:월', 2)).toBe(false)
  })

  it('replaces only {date} and leaves other placeholders and special sequences alone', () => {
    expect(renderTemplate('{date}|{DATE}|{{date}}|${HOME}|$(id)|{env:HOME}|$&', '2026-11-13')).toBe(
      '2026-11-13|{DATE}|{2026-11-13}|${HOME}|$(id)|{env:HOME}|$&'
    )
  })

  it('computes the next run time', () => {
    const fri = new Date('2026-11-13T12:00:00Z')
    expect(nextRunAt('daily', false, fri, 'UTC')).toBe(fri.getTime())
    expect(nextRunAt('daily', true, fri, 'UTC')).toBe(Date.parse('2026-11-14T00:00:00Z'))
    // 금요일에 만든 평일 업무는 다음 월요일 0시.
    expect(nextRunAt('weekdays', true, fri, 'UTC')).toBe(Date.parse('2026-11-16T00:00:00Z'))
    expect(nextRunAt('weekly:금', false, fri, 'UTC')).toBe(fri.getTime())
    expect(nextRunAt('weekly:월', false, fri, 'UTC')).toBe(Date.parse('2026-11-16T00:00:00Z'))
    // 서울 기준 다음 날 0시는 UTC 15:00.
    expect(nextRunAt('daily', true, fri, 'Asia/Seoul')).toBe(Date.parse('2026-11-13T15:00:00Z'))
  })
})

describe('recurring.md document', () => {
  it('round-trips definitions and keeps unreadable blocks counted', () => {
    const a = def()
    const b = def({
      id: 'weekly-report',
      cadence: 'weekly:월',
      count: 3,
      assignee: 'developer',
      criteriaTemplates: ['a', 'b']
    })
    const text = serializeRecurring('# 반복 업무\n\n메모', [a, b])
    const parsed = parseRecurring(text)
    expect(parsed.defs).toEqual([a, b])
    expect(parsed.preface).toContain('메모')
    const broken = text + '\n## 반복: bad\n- 프로젝트: web\n'
    expect(parseRecurring(broken).unreadable).toBe(1)
  })

  it('preserves preface, non-block sections, block order and unknown block lines on rewrite', async () => {
    const t = await setup()
    const a = def({ id: 'zeta' })
    const b = def({ id: 'alpha' })
    const original = `${serializeRecurring('# 반복 업무\n\n앞머리 설명', [a])}
## 메모
사람이 쓴 메모
- 항목

${serializeRecurring('x', [b]).replace('x\n\n', '')}
블록 아래 주석
`
    await t.c.fs.writeText('company/recurring.md', original)
    const r = await t.svc.add(def({ id: 'new-one' }))
    expect(r.ok).toBe(true)
    const text = await readFile(join(t.c.dir, 'company/recurring.md'), 'utf8')
    expect(text).toContain('앞머리 설명')
    expect(text).toContain('## 메모\n사람이 쓴 메모\n- 항목')
    expect(text).toContain('블록 아래 주석')
    const order = ['zeta', '## 메모', 'alpha', 'new-one'].map((k) => text.indexOf(k))
    expect([...order].sort((x, y) => x - y)).toEqual(order)
    await t.svc.remove({ id: 'zeta' })
    const after = await readFile(join(t.c.dir, 'company/recurring.md'), 'utf8')
    expect(after).not.toContain('## 반복: zeta')
    expect(after).toContain('## 메모\n사람이 쓴 메모')
    expect(after).toContain('앞머리 설명')
  })

  it('uses only the first of duplicate ids', () => {
    const text = serializeRecurring('# x', [def(), def({ titleTemplate: 'other' })])
    const p = parseRecurring(text)
    expect(p.defs).toHaveLength(1)
    expect(p.unreadable).toBe(1)
  })
})

describe('RecurringService CRUD', () => {
  it('adds, lists with next run, pauses, updates and removes definitions only', async () => {
    const t = await setup()
    expect((await t.svc.add(def())).ok).toBe(true)
    let list = await t.svc.list()
    if (!list.ok) throw new Error('list')
    expect(list.value.items[0]).toMatchObject({
      id: 'blog',
      createdToday: false,
      nextRunAt: FRI_NOON_UTC.getTime()
    })
    expect((await t.svc.add(def())).ok).toBe(false)
    expect((await t.svc.setStatus({ id: 'blog', status: 'paused' })).ok).toBe(true)
    list = await t.svc.list()
    if (!list.ok) throw new Error('list')
    expect(list.value.items[0].nextRunAt).toBeNull()
    expect((await t.svc.update(def({ count: 2 }))).ok).toBe(true)
    await t.svc.setStatus({ id: 'blog', status: 'active' })
    await t.svc.materialize()
    expect((await t.svc.remove({ id: 'blog' })).ok).toBe(true)
    expect((await t.backlog()).length).toBe(2)
    expect((await t.svc.remove({ id: 'blog' })).ok).toBe(false)
  })

  it('rejects invalid input, unknown keys, archived or unknown projects and unknown assignees', async () => {
    const t = await setup()
    const code = async (r: Promise<{ ok: boolean; code?: string }>): Promise<string | undefined> =>
      (await r).code
    expect(await code(t.svc.add({ ...def(), extra: 1 }))).toBe('invalid-request')
    expect(await code(t.svc.add(def({ id: 'Bad_ID' })))).toBe('invalid-request')
    expect(await code(t.svc.add(def({ count: 6 })))).toBe('invalid-request')
    expect(await code(t.svc.add(def({ count: 0 })))).toBe('invalid-request')
    expect(await code(t.svc.add(def({ cadence: 'hourly' as never })))).toBe('invalid-request')
    expect(await code(t.svc.add(def({ cadence: 'weekly:x' as never })))).toBe('invalid-request')
    expect(await code(t.svc.add(def({ titleTemplate: 'a\nb' })))).toBe('invalid-request')
    expect(await code(t.svc.add(def({ goalTemplate: '# heading' })))).toBe('invalid-request')
    expect(await code(t.svc.add(def({ goalTemplate: '- **담당:** x' })))).toBe('invalid-request')
    expect(await code(t.svc.add(def({ projectId: 'old' })))).toBe('invalid-request')
    expect(await code(t.svc.add(def({ projectId: 'none' })))).toBe('invalid-request')
    expect(await code(t.svc.add(def({ assignee: 'ghost' })))).toBe('invalid-request')
    expect(await code(t.svc.setStatus({ id: 'x', status: 'weird' }))).toBe('invalid-request')
    expect(await code(t.svc.update(def()))).toBe('not-found')
  })

  it('caps definitions at 50', async () => {
    const t = await setup()
    for (let i = 0; i < 50; i++) expect((await t.svc.add(def({ id: `d-${i}` }))).ok).toBe(true)
    const r = await t.svc.add(def({ id: 'one-more' }))
    expect(r.ok).toBe(false)
  })

  it('refuses to rewrite a file that has unreadable blocks', async () => {
    const t = await setup()
    await t.c.fs.writeText('company/recurring.md', '# x\n\n## 반복: bad\n- 프로젝트: web\n')
    const r = await t.svc.add(def())
    expect(r.ok).toBe(false)
    expect(await readFile(join(t.c.dir, 'company/recurring.md'), 'utf8')).toContain('## 반복: bad')
  })

  it('does not leak paths in errors', async () => {
    const t = await setup()
    const r = await t.svc.add(def({ projectId: 'none' }))
    expect(JSON.stringify(r)).not.toContain(t.c.dir)
  })
})

describe('materialize', () => {
  it('creates today share once and is idempotent across runs and instances', async () => {
    const t = await setup()
    await t.svc.add(def())
    const first = await t.svc.materialize()
    expect(first.created).toHaveLength(1)
    const second = await t.svc.materialize()
    expect(second.created).toHaveLength(0)
    const names = await t.backlog()
    expect(names).toHaveLength(1)
    const body = await t.readBacklog(names[0])
    expect(body).toContain('- **반복:** blog/2026-11-13')
    expect(body).toContain('# T-001: Blog post 2026-11-13')
    expect(body).toContain('- **담당:** pm')
    expect(body).toContain('- **프로젝트:** web')
    const list = await t.svc.list()
    if (!list.ok) throw new Error('list')
    expect(list.value.items[0].createdToday).toBe(true)
    expect(list.value.items[0].nextRunAt).toBe(Date.parse('2026-11-14T00:00:00Z'))
  })

  it('concurrent materialize calls create each ticket once', async () => {
    const t = await setup()
    await t.svc.add(def({ count: 2 }))
    await Promise.all([t.svc.materialize(), t.svc.materialize(), t.svc.materialize()])
    expect(await t.backlog()).toHaveLength(2)
  })

  it('makes count tickets with numbered titles and completes a partial day', async () => {
    const t = await setup()
    await t.svc.add(def({ count: 3 }))
    await t.svc.materialize()
    const names = await t.backlog()
    expect(names).toHaveLength(3)
    const titles = await Promise.all(names.map((n) => t.readBacklog(n)))
    expect(titles.some((b) => b.includes('Blog post 2026-11-13 (3/3)'))).toBe(true)
  })

  it('does not backfill missed days: only today is created', async () => {
    const t = await setup()
    await t.svc.add(def())
    t.clock.now = new Date('2026-11-10T09:00:00Z')
    await t.svc.materialize()
    // 앱이 3일 꺼져 있다가 다시 켜졌다.
    t.clock.now = new Date('2026-11-13T09:00:00Z')
    const r = await t.svc.materialize()
    expect(r.created).toHaveLength(1)
    expect(await t.backlog()).toHaveLength(2)
  })

  it('respects cadence', async () => {
    const t = await setup({ now: new Date('2026-11-14T12:00:00Z') }) // 토요일
    await t.svc.add(def({ id: 'wk', cadence: 'weekdays' }))
    await t.svc.add(def({ id: 'sat', cadence: 'weekly:토' }))
    await t.svc.add(def({ id: 'mon', cadence: 'weekly:월' }))
    const r = await t.svc.materialize()
    expect(r.created.map((c) => c.definitionId)).toEqual(['sat'])
  })

  it('skips paused definitions', async () => {
    const t = await setup()
    await t.svc.add(def({ status: 'paused' }))
    expect((await t.svc.materialize()).created).toHaveLength(0)
  })

  it('caps the company-wide daily total at 20, counting tickets already made today', async () => {
    const t = await setup()
    for (let i = 0; i < 5; i++) await t.svc.add(def({ id: `d-${i}`, count: 5 }))
    const r = await t.svc.materialize()
    expect(r.created).toHaveLength(20)
    expect(r.notes.some((n) => n.includes('20건'))).toBe(true)
    expect((await t.svc.materialize()).created).toHaveLength(0)
    expect(await t.backlog()).toHaveLength(20)
  })

  it('skips pm-required projects and reports them as blockers', async () => {
    const t = await setup()
    await t.svc.add(def({ id: 'a' }))
    t.clock.now = FRI_NOON_UTC
    const doc = await t.svc.list()
    expect(doc.ok).toBe(true)
    // nopm 프로젝트에는 add 단계에서 정의를 만들 수 있다 (티켓 생성은 되는 프로젝트이므로).
    await t.svc.add(def({ id: 'b', projectId: 'nopm' }))
    const r = await t.svc.materialize()
    expect(r.created.map((c) => c.definitionId)).toEqual(['a'])
    expect(r.notes.some((n) => n.startsWith('b:') && n.includes('PM'))).toBe(true)
  })

  it('skips archived projects without a ticket', async () => {
    const t = await setup()
    await t.svc.add(def({ id: 'a' }))
    const archived = [proj('web', { status: 'archived', state: 'archived' })]
    const svc2 = new RecurringService({
      ...(t.svc as unknown as { deps: ConstructorParameters<typeof RecurringService>[0] }).deps,
      projects: async () => archived
    })
    const r = await svc2.materialize()
    expect(r.created).toHaveLength(0)
    expect(await t.backlog()).toHaveLength(0)
  })

  it('skips projects whose policy active days exclude today, and fails closed on bad hours', async () => {
    const t = await setup({
      hours: [
        { projectId: 'web', hours: '월-목 09:00-18:00' },
        { projectId: 'team', hours: '???' }
      ]
    })
    await t.svc.add(def({ id: 'a' })) // 금요일
    await t.svc.add(def({ id: 'b', projectId: 'team' }))
    const r = await t.svc.materialize()
    expect(r.created).toHaveLength(0)
    expect(r.notes.some((n) => n.startsWith('b:'))).toBe(true)
    expect(r.notes.some((n) => n.startsWith('a:'))).toBe(false)
  })

  it('fails closed when a policy cannot be read', async () => {
    const t = await setup({ hours: [{ projectId: 'web', hours: null, unreadable: true }] })
    await t.svc.add(def())
    const r = await t.svc.materialize()
    expect(r.created).toHaveLength(0)
    expect(r.notes).toHaveLength(1)
  })

  it('assigns a project member, and falls back with a warning when the assignee is not assigned', async () => {
    const t = await setup()
    await t.svc.add(def({ id: 'ok', projectId: 'team', assignee: 'developer' }))
    await t.svc.add(def({ id: 'no', projectId: 'web', assignee: 'developer' }))
    const r = await t.svc.materialize()
    expect(r.created).toHaveLength(2)
    expect(r.notes.some((n) => n.startsWith('no:') && n.includes('배정'))).toBe(true)
    const bodies = await Promise.all((await t.backlog()).map((n) => t.readBacklog(n)))
    const ok = bodies.find((b) => b.includes('team/')) ?? bodies.find((b) => b.includes('ok/'))
    expect(ok).toContain('- **담당:** developer')
    expect(bodies.find((b) => b.includes('no/'))).toContain('- **담당:** pm')
  })

  it('does not interpret anything but {date} in templates', async () => {
    const t = await setup()
    await t.svc.add(
      def({ titleTemplate: 'Run {date} {env:HOME} $(id)', goalTemplate: 'Do ${HOME} {{date}}' })
    )
    await t.svc.materialize()
    const body = await t.readBacklog((await t.backlog())[0])
    expect(body).toContain('Run 2026-11-13 {env:HOME} $(id)')
    expect(body).toContain('Do ${HOME} {2026-11-13}')
  })

  it('uses the injected time zone at the date boundary', async () => {
    const at = new Date('2026-11-13T15:30:00Z') // 서울 11/14 00:30, UTC 11/13
    const seoul = await setup({ now: at, tz: 'Asia/Seoul' })
    await seoul.svc.add(def())
    await seoul.svc.materialize()
    expect(await seoul.readBacklog((await seoul.backlog())[0])).toContain('blog/2026-11-14')
    const utc = await setup({ now: at, tz: 'UTC' })
    await utc.svc.add(def())
    await utc.svc.materialize()
    expect(await utc.readBacklog((await utc.backlog())[0])).toContain('blog/2026-11-13')
  })

  it('creates the next day share after midnight', async () => {
    const t = await setup({ now: new Date('2026-11-13T23:59:00Z') })
    await t.svc.add(def())
    await t.svc.materialize()
    t.clock.now = new Date('2026-11-14T00:01:00Z')
    expect((await t.svc.materialize()).created).toHaveLength(1)
    expect(await t.backlog()).toHaveLength(2)
  })

  it('reports unreadable definitions and the 50 definition limit', async () => {
    const t = await setup()
    const many = Array.from({ length: 52 }, (_, i) => def({ id: `d-${i}`, status: 'paused' }))
    await t.c.fs.writeText(
      'company/recurring.md',
      serializeRecurring('# x', many) + '\n## 반복: bad\n- 프로젝트: web\n'
    )
    const r = await t.svc.materialize()
    expect(r.notes.some((n) => n.includes('50개'))).toBe(true)
    expect(r.notes.some((n) => n.includes('읽을 수 없는'))).toBe(true)
  })
})
