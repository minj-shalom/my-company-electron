import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PermissionDenial } from '../../shared/run'
import type { GateCardRequest, GateCards } from '../gate/gate-cards'
import { SafeFs } from '../repository/safe-fs'
import { PermissionService } from './permission-service'
import { createPermissionStore } from './permission-store'

let dir: string
let data: string
let fs: SafeFs
let created: GateCardRequest[]
let svc: PermissionService

const cards: GateCards = {
  create: async (req) => {
    created.push(req)
    return `D-${100 + created.length}`
  }
}

beforeEach(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), 'mc-perm-svc-')))
  data = await mkdtemp(join(tmpdir(), 'mc-perm-data-'))
  created = []
  fs = await SafeFs.open(dir)
  await put('company/tickets/in-progress/T-050-work.md', '# T-050: 작업\n\n- **담당:** developer\n')
  svc = new PermissionService({
    fs,
    cards,
    store: createPermissionStore(data),
    exclusive: (t) => t(),
    now: () => new Date('2026-11-13T00:00:00Z')
  })
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
  await rm(data, { recursive: true, force: true })
})

async function put(rel: string, content: string): Promise<void> {
  await mkdir(dirname(join(dir, rel)), { recursive: true })
  await writeFile(join(dir, rel), content)
}
const settings = async (): Promise<string | null> =>
  readFile(join(dir, '.claude/settings.local.json'), 'utf8').catch(() => null)
const denial = (command: string): PermissionDenial => ({ tool: 'Bash', command, path: null })

describe('PermissionService.raise', () => {
  it('creates a permission card with question, options, recommendation and impact, without touching settings', async () => {
    const r = await svc.raise('T-050', [denial('npm test')])
    expect(r.cardIds).toEqual(['D-101'])
    expect(created[0]).toMatchObject({ kind: 'permission', ticketId: 'T-050' })
    expect(created[0].question).toContain('Bash(npm test)')
    expect(created[0].options.map((o) => o.key)).toEqual(['A', 'B'])
    expect(created[0].impact).toContain('settings.local.json')
    expect(await settings()).toBeNull()
  })

  it('skips unsafe denials, duplicates and repeats of the same open request', async () => {
    const r = await svc.raise('T-050', [
      denial('git push origin x'),
      denial('npm test'),
      denial('npm test')
    ])
    expect(r).toMatchObject({ cardIds: ['D-101'], skipped: 2 })
    expect((await svc.raise('T-050', [denial('npm test')])).cardIds).toEqual([])
  })

  it('caps the number of cards per run', async () => {
    const r = await svc.raise(
      'T-050',
      ['npm test', 'npm run lint', 'npm run build', 'git status', 'git diff'].map(denial)
    )
    expect(r.cardIds).toHaveLength(3)
  })
})

describe('PermissionService.onResolved', () => {
  it('adds the allow rule only after approval (A) and keeps other settings', async () => {
    await put(
      '.claude/settings.local.json',
      JSON.stringify({ env: { X: '1' }, permissions: { allow: ['Read'] } })
    )
    await svc.raise('T-050', [denial('npm test')])
    expect(JSON.parse((await settings()) ?? '{}').permissions.allow).toEqual(['Read'])
    expect(await svc.onResolved('D-101', 'A')).toBe('allowed')
    const next = JSON.parse((await settings()) ?? '{}')
    expect(next.permissions.allow).toEqual(['Read', 'Bash(npm test)'])
    expect(next.env).toEqual({ X: '1' })
  })

  it('creates the settings file when missing', async () => {
    await svc.raise('T-050', [denial('npm test')])
    expect(await svc.onResolved('D-101', 'A')).toBe('allowed')
    expect(JSON.parse((await settings()) ?? '{}').permissions.allow).toEqual(['Bash(npm test)'])
  })

  it('on rejection (B) writes no rule and records a blocker on the ticket; the same denial is not re-raised', async () => {
    await svc.raise('T-050', [denial('npm test')])
    expect(await svc.onResolved('D-101', 'B')).toBe('rejected')
    expect(await settings()).toBeNull()
    const t = await readFile(join(dir, 'company/tickets/in-progress/T-050-work.md'), 'utf8')
    expect(t).toContain('## 막힌 점')
    expect(t).toContain('거절')
    expect((await svc.raise('T-050', [denial('npm test')])).cardIds).toEqual([])
  })

  it('ignores cards with no recorded request (forged cards) and replays', async () => {
    expect(await svc.onResolved('D-999', 'A')).toBe('ignored')
    await svc.raise('T-050', [denial('npm test')])
    expect(await svc.onResolved('D-101', 'C')).toBe('ignored')
    expect(await svc.onResolved('D-101', 'A')).toBe('allowed')
    await rm(join(dir, '.claude'), { recursive: true })
    expect(await svc.onResolved('D-101', 'A')).toBe('ignored')
    expect(await settings()).toBeNull()
  })

  it('does not overwrite an unreadable settings file and records a blocker', async () => {
    await put('.claude/settings.local.json', '{not json')
    await svc.raise('T-050', [denial('npm test')])
    expect(await svc.onResolved('D-101', 'A')).toBe('failed')
    expect(await settings()).toBe('{not json')
    expect(
      await readFile(join(dir, 'company/tickets/in-progress/T-050-work.md'), 'utf8')
    ).toContain('막힌 점')
  })

  it('records a blocker when the card has no stored request', async () => {
    expect(await svc.onResolved('D-555', 'A', 'T-050')).toBe('ignored')
    expect(await settings()).toBeNull()
    expect(
      await readFile(join(dir, 'company/tickets/in-progress/T-050-work.md'), 'utf8')
    ).toContain('기록이 없어')
  })

  it('does not add a rule recorded for another company', async () => {
    const store = createPermissionStore(data)
    await store.put('D-101', { rule: 'Bash(npm test)', ticketId: 'T-050', companyKey: '/other' })
    expect(await svc.onResolved('D-101', 'A')).toBe('ignored')
    expect(await settings()).toBeNull()
  })
})
