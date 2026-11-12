import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { WeeklyLimit } from '../../shared/provider'
import { createWeeklyLimitsStore } from './weekly-limits-store'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mc-wl-'))
})
afterEach(() => rm(dir, { recursive: true, force: true }))

const lim = (amount: number): WeeklyLimit[] => [{ provider: 'claude', amount, unit: 'usd' }]

describe('weekly limits store', () => {
  it('serializes overlapping saves; the last call wins and no tmp files remain', async () => {
    const store = createWeeklyLimitsStore(dir)
    await Promise.all(Array.from({ length: 20 }, (_, i) => store.save(lim(i + 1))))
    expect(await store.load()).toEqual(lim(20))
    expect((await readdir(dir)).filter((f) => f.endsWith('.tmp'))).toEqual([])
    expect(JSON.parse(await readFile(join(dir, 'weekly-limits.json'), 'utf8')).limits).toEqual(
      lim(20)
    )
  })

  it('recovers with save after a corrupt file', async () => {
    const store = createWeeklyLimitsStore(dir)
    await writeFile(join(dir, 'weekly-limits.json'), '{broken', 'utf8')
    expect(await store.load()).toEqual([])
    await store.save(lim(5))
    expect(await store.load()).toEqual(lim(5))
  })

  it('a failed save cleans its tmp file and does not block later saves', async () => {
    const store = createWeeklyLimitsStore(join(dir, 'blocked'))
    await writeFile(join(dir, 'blocked'), 'file, not dir', 'utf8')
    await expect(store.save(lim(1))).rejects.toThrow()
    await rm(join(dir, 'blocked'))
    await store.save(lim(2))
    expect(await store.load()).toEqual(lim(2))
    expect((await readdir(join(dir, 'blocked'))).filter((f) => f.endsWith('.tmp'))).toEqual([])
  })
})
