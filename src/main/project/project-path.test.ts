import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { checkProjectDir } from './project-path'

const made: string[] = []
afterEach(async () => {
  for (const d of made.splice(0)) await rm(d, { recursive: true, force: true })
})

async function setup(): Promise<{
  root: string
  ws: string
  ctx: { companyRoot: string; homeDir: string }
}> {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'mc-path-')))
  made.push(base)
  const root = join(base, 'company')
  const ws = join(base, 'ws')
  await mkdir(root, { recursive: true })
  await mkdir(join(root, 'inner'), { recursive: true })
  await mkdir(ws, { recursive: true })
  return { root, ws, ctx: { companyRoot: root, homeDir: join(base, 'home') } }
}

describe('checkProjectDir', () => {
  it('accepts an existing directory outside the company folder and returns the real path', async () => {
    const { ws, ctx } = await setup()
    await mkdir(join(ws, 'repo'))
    expect(await checkProjectDir(join(ws, 'repo'), ctx)).toEqual({
      ok: true,
      real: join(ws, 'repo')
    })
  })
  it.each([
    [undefined, 'invalid'],
    ['', 'invalid'],
    ['a\0b', 'invalid'],
    ['x'.repeat(2000), 'invalid'],
    ['relative/dir', 'not-absolute'],
    ['/tmp/../etc', 'dotdot']
  ])('rejects %j', async (input, reason) => {
    const { ctx } = await setup()
    expect(await checkProjectDir(input, ctx)).toEqual({ ok: false, reason })
  })
  it('rejects missing paths and files', async () => {
    const { ws, ctx } = await setup()
    await writeFile(join(ws, 'f.txt'), 'x')
    expect(await checkProjectDir(join(ws, 'nope'), ctx)).toEqual({ ok: false, reason: 'not-found' })
    expect(await checkProjectDir(join(ws, 'f.txt'), ctx)).toEqual({
      ok: false,
      reason: 'not-directory'
    })
  })
  it('rejects the filesystem root and the home folder (also through a link)', async () => {
    const { ws, ctx } = await setup()
    await mkdir(ctx.homeDir)
    await symlink(ctx.homeDir, join(ws, 'home-link'))
    expect(await checkProjectDir('/', ctx)).toEqual({ ok: false, reason: 'too-broad' })
    expect(await checkProjectDir(ctx.homeDir, ctx)).toEqual({ ok: false, reason: 'too-broad' })
    expect(await checkProjectDir(join(ws, 'home-link'), ctx)).toEqual({
      ok: false,
      reason: 'too-broad'
    })
  })
  it('rejects the company folder, its parent, its children, and links to them', async () => {
    const { root, ws, ctx } = await setup()
    await symlink(root, join(ws, 'company-link'))
    for (const p of [root, join(root, 'inner'), join(root, '..'), join(ws, 'company-link')]) {
      const r = await checkProjectDir(p === join(root, '..') ? join(root, '..') : p, ctx)
      // `..`가 든 입력은 형태 단계에서 막히므로, 상위 폴더는 정규화된 경로로 다시 확인한다.
      expect(r.ok).toBe(false)
    }
    expect(await checkProjectDir(root, ctx)).toEqual({ ok: false, reason: 'company-overlap' })
    expect(await checkProjectDir(join(root, 'inner'), ctx)).toEqual({
      ok: false,
      reason: 'company-overlap'
    })
    expect(await checkProjectDir(join(ws, '..'), ctx)).toMatchObject({ ok: false })
    expect(await checkProjectDir(join(ws, 'company-link'), ctx)).toEqual({
      ok: false,
      reason: 'company-overlap'
    })
    const parent = join(root, '..')
    expect(await checkProjectDir(await realpath(parent), ctx)).toEqual({
      ok: false,
      reason: 'company-overlap'
    })
  })
  it('allows relative paths only when reading stored legacy values', async () => {
    const { ws, ctx } = await setup()
    await mkdir(join(ws, 'repo'))
    expect(await checkProjectDir('../ws/repo', ctx, true)).toEqual({
      ok: true,
      real: join(ws, 'repo')
    })
  })
})
