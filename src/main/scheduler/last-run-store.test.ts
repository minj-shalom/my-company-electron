import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { createLastRunStore } from './last-run-store'
import { shouldQuitWhenAllWindowsClosed } from './tray'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mc-sched-'))
})
afterEach(() => rm(dir, { recursive: true, force: true }))

it('saves and loads per company key', async () => {
  const s = createLastRunStore(dir)
  expect(await s.load('/a')).toBeNull()
  await s.save('/a', 5)
  await s.save('/b', 7)
  expect(await s.load('/a')).toBe(5)
  expect(await s.load('/b')).toBe(7)
})

it('treats a corrupt state file as no history', async () => {
  await writeFile(join(dir, 'scheduler-state.json'), '{not json')
  expect(await createLastRunStore(dir).load('/a')).toBeNull()
})

it('keeps running in the tray when windows close', () => {
  expect(shouldQuitWhenAllWindowsClosed('win32', true)).toBe(false)
  expect(shouldQuitWhenAllWindowsClosed('win32', false)).toBe(true)
  expect(shouldQuitWhenAllWindowsClosed('darwin', false)).toBe(false)
})
