import { readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ProjectChangeResult, ProjectInfo } from '../../shared/project'
import type { ApiResult } from '../../shared/result'
import { removeMember } from '../org/org-store'
import type { GitOutcome, GitRunner } from './git-probe'
import { PROJECT_FILE } from './project-service'
import {
  FIXTURE_PROJECT_MD,
  makeDir,
  makeProjectTest,
  pick,
  projectText,
  type ProjectTest
} from './test-project-company'

const tests: ProjectTest[] = []
afterEach(async () => {
  for (const t of tests.splice(0))
    for (const d of t.dirs) await rm(d, { recursive: true, force: true })
})
async function setup(opts: Parameters<typeof makeProjectTest>[0] = {}): Promise<ProjectTest> {
  const t = await makeProjectTest(opts)
  tests.push(t)
  return t
}
const ok = <T>(r: ApiResult<T>): T => {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.message}`)
  return r.value
}
const code = (r: ApiResult<unknown>): string => (r.ok ? 'ok' : r.code)

async function addRepo(
  t: ProjectTest,
  name: string,
  extra: Record<string, unknown> = {}
): Promise<ProjectChangeResult> {
  const dir = await makeDir(t.ws, name, true)
  return ok(await t.svc.add({ path: await pick(t.svc, dir), name, ...extra }))
}

describe('project:list', () => {
  it('interprets the legacy single format without touching the file', async () => {
    const t = await setup()
    const before = await projectText(t)
    const list = ok(await t.svc.list())
    expect(list.format).toBe('legacy')
    expect(list.items.map((p) => [p.id, p.state, p.pm, p.git.status])).toEqual([
      ['my-company', 'pm-required', null, 'missing'],
      ['my-company-landing', 'pm-required', null, 'missing']
    ])
    expect(await projectText(t)).toBe(before)
  })
  it('is empty when project.md does not exist', async () => {
    const t = await setup({ projectMd: null })
    expect(ok(await t.svc.list())).toEqual({ items: [], unreadable: [], format: 'empty' })
  })
  it('reports unreadable blocks without raw content', async () => {
    const t = await setup({ projectMd: '## 프로젝트: A\n- id: __proto__\n- 경로: /secret/path\n' })
    const list = ok(await t.svc.list())
    expect(list.items).toEqual([])
    expect(list.unreadable).toEqual([{ line: 1, reason: 'invalid-block' }])
    expect(JSON.stringify(list)).not.toContain('secret')
  })
  it('shows branch and dirty state from read-only git calls', async () => {
    const t = await setup({ projectMd: null })
    const dir = await makeDir(t.ws, 'app', true)
    ok(await t.svc.add({ path: await pick(t.svc, dir), name: 'App' }))
    let p = ok(await t.svc.list()).items[0]
    expect(p.git).toMatchObject({ status: 'ok', dirty: false })
    await writeFile(join(dir, 'new.txt'), 'x')
    p = ok(await t.svc.list()).items[0]
    expect(p.git).toMatchObject({ status: 'ok', dirty: true })
  })
})

describe('project:add', () => {
  it('creates project.md on the first add and writes a block', async () => {
    const t = await setup({ projectMd: null })
    const r = await addRepo(t, 'app', { devCommand: 'npm run dev', defaultBranch: 'develop' })
    expect(r.project).toMatchObject({
      id: 'app',
      type: 'development',
      status: 'active',
      state: 'pm-required'
    })
    expect(r.record).toMatchObject({
      action: 'add',
      actor: 'ceo-ui',
      approval: null,
      projectId: 'app'
    })
    const text = await projectText(t)
    expect(text).toContain('## 프로젝트: app\n- id: app\n- 유형: development\n- 경로: ')
    expect(text).toContain('- dev 명령: npm run dev\n')
    expect(text).toContain('- 기본 브랜치: develop\n')
  })
  it('only accepts paths the main-side dialog returned (and consumes the approval)', async () => {
    const t = await setup({ projectMd: null })
    const dir = await makeDir(t.ws, 'app', true)
    expect(code(await t.svc.add({ path: dir, name: 'App' }))).toBe('path-not-allowed')
    const approved = await pick(t.svc, dir)
    expect(code(await t.svc.add({ path: approved, name: 'App' }))).toBe('ok')
    expect(code(await t.svc.add({ path: approved, name: 'App2' }))).toBe('path-not-allowed')
    // 다이얼로그를 취소하면 승인도 없다.
    expect(await t.svc.selectFolder(async () => null)).toBeNull()
  })
  it('rejects a path whose link was swapped after selection', async () => {
    const t = await setup({ projectMd: null })
    const a = await makeDir(t.ws, 'a', true)
    const b = await makeDir(t.ws, 'b', true)
    const link = join(t.ws, 'link')
    await symlink(a, link)
    await pick(t.svc, link)
    await rm(link)
    await symlink(b, link)
    expect(code(await t.svc.add({ path: link, name: 'X' }))).toBe('path-not-allowed')
  })
  it('rejects company folder, its parent, home and a non-git development folder', async () => {
    const t = await setup({ projectMd: null })
    expect(code(await t.svc.add({ path: await pick(t.svc, t.c.dir), name: 'C' }))).toBe(
      'invalid-request'
    )
    const inner = await makeDir(t.c.dir, 'inner', true)
    expect(code(await t.svc.add({ path: await pick(t.svc, inner), name: 'I' }))).toBe(
      'invalid-request'
    )
    const home = await makeDir(t.ws, 'home', true)
    const t2 = await setup({ projectMd: null, homeDir: home })
    expect(code(await t2.svc.add({ path: await pick(t2.svc, home), name: 'H' }))).toBe(
      'invalid-request'
    )
    const plain = await makeDir(t.ws, 'plain', false)
    expect(code(await t.svc.add({ path: await pick(t.svc, plain), name: 'P' }))).toBe(
      'invalid-request'
    )
    expect(await projectText(t).catch(() => null)).toBeNull()
  })
  it('requires the git root for development and allows any folder for content', async () => {
    const t = await setup({ projectMd: null })
    const repo = await makeDir(t.ws, 'repo', true)
    const sub = await makeDir(repo, 'sub', false)
    expect(code(await t.svc.add({ path: await pick(t.svc, sub), name: 'Sub' }))).toBe(
      'invalid-request'
    )
    const blog = await makeDir(t.ws, 'blog', false)
    const r = ok(await t.svc.add({ path: await pick(t.svc, blog), name: 'Blog', type: 'content' }))
    expect(r.project.git).toEqual({ status: 'not-repo' })
    // content에는 dev 명령이 없다.
    const other = await makeDir(t.ws, 'o', false)
    expect(
      code(
        await t.svc.add({
          path: await pick(t.svc, other),
          name: 'O',
          type: 'other',
          devCommand: 'x'
        })
      )
    ).toBe('invalid-request')
  })
  it('rejects duplicate paths (also through a link, case/archived included) and duplicate names', async () => {
    const t = await setup({ projectMd: null })
    const dir = await makeDir(t.ws, 'app', true)
    ok(await t.svc.add({ path: await pick(t.svc, dir), name: 'App' }))
    const link = join(t.ws, 'app-link')
    await symlink(dir, link)
    expect(code(await t.svc.add({ path: await pick(t.svc, link), name: 'Other' }))).toBe('conflict')
    ok(await t.svc.archive({ id: 'app' }))
    expect(code(await t.svc.add({ path: await pick(t.svc, dir), name: 'Other' }))).toBe('conflict')
    const d2 = await makeDir(t.ws, 'app2', true)
    expect(code(await t.svc.add({ path: await pick(t.svc, d2), name: 'APP' }))).toBe('conflict')
  })
  it.each([
    ['empty', ''],
    ['51 chars', 'a'.repeat(51)],
    ['newline', 'a\nb'],
    ['CR', 'a\rb'],
    ['line separator', 'a b'],
    ['control', 'a\u0007b'],
    ['zero width', 'a​b'],
    ['bidi override', 'a‮b'],
    ['heading marker', '# x'],
    ['pipe', 'a|b'],
    ['backtick', 'a`b'],
    ['bracket', '[a]'],
    ['edge space', ' a'],
    ['non string', 5]
  ])('rejects the name: %s', async (_n, name) => {
    const t = await setup({ projectMd: null })
    const dir = await makeDir(t.ws, 'app', true)
    const path = await pick(t.svc, dir)
    expect(code(await t.svc.add({ path, name }))).toBe('invalid-request')
    expect(await projectText(t).catch(() => null)).toBeNull()
  })
  it('rejects unknown keys such as actor or __proto__', async () => {
    const t = await setup({ projectMd: null })
    const dir = await makeDir(t.ws, 'app', true)
    const path = await pick(t.svc, dir)
    expect(code(await t.svc.add({ path, name: 'A', actor: 'approved-proposal' }))).toBe(
      'invalid-request'
    )
    expect(
      code(
        await t.svc.add(
          JSON.parse(`{"path":${JSON.stringify(path)},"name":"A","__proto__":{"x":1}}`)
        )
      )
    ).toBe('invalid-request')
    expect(code(await t.svc.add(null))).toBe('invalid-request')
    expect(code(await t.svc.add([]))).toBe('invalid-request')
    expect(code(await t.svc.rename({ id: '__proto__', name: 'x' }))).toBe('invalid-request')
  })
  it('converts the legacy file on the first add and keeps its lines', async () => {
    const t = await setup()
    const original = await readFile(FIXTURE_PROJECT_MD, 'utf8')
    const r = await addRepo(t, 'blog-app')
    expect(r.project.id).toBe('blog-app')
    const text = await projectText(t)
    expect(text.startsWith(original.trimEnd())).toBe(true)
    const list = ok(await t.svc.list())
    expect(list.format).toBe('blocks')
    expect(list.items.map((p) => p.id)).toEqual(['my-company', 'my-company-landing', 'blog-app'])
  })
  it('never modifies the repo folder (no new files, no deletes)', async () => {
    const t = await setup({ projectMd: null })
    const dir = await makeDir(t.ws, 'app', true)
    await writeFile(join(dir, 'a.txt'), 'a')
    const snap = async (): Promise<string[]> => (await readdir(dir, { recursive: true })).sort()
    const before = await snap()
    ok(await t.svc.add({ path: await pick(t.svc, dir), name: 'App' }))
    ok(await t.svc.list())
    ok(await t.svc.archive({ id: 'app' }))
    ok(await t.svc.restore({ id: 'app' }))
    expect(await snap()).toEqual(before)
  })
})

describe('rename / archive / restore / type', () => {
  it('rename keeps the id and preserves unknown lines', async () => {
    const t = await setup({ projectMd: null })
    await addRepo(t, 'app')
    const withStaff = (await projectText(t)).replace(
      '- 상태: active\n',
      '- 상태: active\n- 직원: a, b\n'
    )
    await writeFile(join(t.c.dir, PROJECT_FILE), `${withStaff}\n## 정책 메모\n- 자유 형식\n`)
    const r = ok(await t.svc.rename({ id: 'app', name: '새 이름' }))
    expect(r.project).toMatchObject({ id: 'app', name: '새 이름' })
    expect(r.record.changedFields).toEqual(['name'])
    const text = await projectText(t)
    expect(text).toContain('## 프로젝트: 새 이름\n')
    expect(text).toContain('- 직원: a, b\n')
    expect(text).toContain('## 정책 메모\n- 자유 형식\n')
  })
  it('rename rejects duplicates and bad names, and is a no-op for the same name', async () => {
    const t = await setup({ projectMd: null })
    await addRepo(t, 'one')
    await addRepo(t, 'two')
    expect(code(await t.svc.rename({ id: 'two', name: 'ONE' }))).toBe('conflict')
    expect(code(await t.svc.rename({ id: 'two', name: 'a\nb' }))).toBe('invalid-request')
    expect(code(await t.svc.rename({ id: 'nope', name: 'x' }))).toBe('not-found')
    const before = await projectText(t)
    const same = ok(await t.svc.rename({ id: 'two', name: 'two' }))
    expect(same.record.changedFields).toEqual([])
    expect(await projectText(t)).toBe(before)
  })
  it('archives and restores by changing only the status line', async () => {
    const t = await setup({ projectMd: null })
    await addRepo(t, 'app')
    const a = ok(await t.svc.archive({ id: 'app' }))
    expect(a.project).toMatchObject({ status: 'archived', state: 'archived' })
    expect(await projectText(t)).toContain('- 상태: archived')
    expect(ok(await t.svc.archive({ id: 'app' })).record.changedFields).toEqual([])
    expect(ok(await t.svc.restore({ id: 'app' })).project.status).toBe('active')
  })
  it('refuses to archive while an in-progress ticket may belong to the project', async () => {
    const tickets: {
      list: () => Promise<{ tickets: { project: string | null }[]; unreadable: number }>
    } = { list: async () => ({ tickets: [{ project: null }], unreadable: 0 }) }
    const t = await setup({ projectMd: null, inProgress: { list: () => tickets.list() } })
    await addRepo(t, 'one')
    await addRepo(t, 'two')
    // 소속을 알 수 없는 티켓은 모든 프로젝트에 속한 것으로 본다.
    expect(code(await t.svc.archive({ id: 'one' }))).toBe('conflict')
    tickets.list = async () => ({ tickets: [{ project: 'two' }], unreadable: 0 })
    expect(code(await t.svc.archive({ id: 'two' }))).toBe('conflict')
    expect(code(await t.svc.archive({ id: 'one' }))).toBe('ok')
    // 등록되지 않은 id를 가리키는 티켓은 소속 불명이다.
    tickets.list = async () => ({ tickets: [{ project: 'ghost' }], unreadable: 0 })
    expect(code(await t.svc.archive({ id: 'two' }))).toBe('conflict')
    tickets.list = async () => ({ tickets: [], unreadable: 1 })
    expect(code(await t.svc.archive({ id: 'two' }))).toBe('conflict')
    tickets.list = async () => ({ tickets: [], unreadable: 0 })
    expect(code(await t.svc.archive({ id: 'two' }))).toBe('ok')
    expect(await readdir(t.ws)).toEqual(expect.arrayContaining(['one', 'two']))
  })
  it('fails closed when tickets cannot be listed', async () => {
    const t = await setup({
      projectMd: null,
      inProgress: {
        list: async () => {
          throw new Error('/secret/path boom')
        }
      }
    })
    await addRepo(t, 'one')
    const r = await t.svc.archive({ id: 'one' })
    expect(r).toMatchObject({ ok: false, code: 'internal' })
    expect(JSON.stringify(r)).not.toContain('secret')
  })
  it('changes type: dev -> content directly, content -> dev needs git again', async () => {
    const t = await setup({ projectMd: null })
    const dir = await makeDir(t.ws, 'app', true)
    ok(
      await t.svc.add({
        path: await pick(t.svc, dir),
        name: 'App',
        devCommand: 'npm run dev',
        defaultBranch: 'main'
      })
    )
    const c = ok(await t.svc.setType({ id: 'app', type: 'content' }))
    expect(c.project).toMatchObject({ type: 'content', devCommand: null, defaultBranch: null })
    const back = ok(await t.svc.setType({ id: 'app', type: 'development' }))
    expect(back.project.type).toBe('development')
    // .git이 사라진 폴더는 content로는 남지만 development로 되돌릴 수 없다.
    ok(await t.svc.setType({ id: 'app', type: 'other' }))
    await rm(join(dir, '.git'), { recursive: true })
    expect(code(await t.svc.setType({ id: 'app', type: 'development' }))).toBe('invalid-request')
    expect(code(await t.svc.setType({ id: 'app', type: 'weird' as never }))).toBe('invalid-request')
  })
})

describe('담당 PM', () => {
  it('sets and clears the PM, computes ready / pm-required / archived', async () => {
    const t = await setup({ projectMd: null })
    const dir = await makeDir(t.ws, 'app', true)
    const added = ok(await t.svc.add({ path: await pick(t.svc, dir), name: 'App', pm: 'pm' }))
    expect(added.project).toMatchObject({ state: 'ready', pmId: 'pm', pm: { id: 'pm' } })
    expect(added.record).toMatchObject({ pmBefore: null, pmAfter: 'pm' })
    const cleared = ok(await t.svc.clearPm({ id: 'app' }))
    expect(cleared.project).toMatchObject({ state: 'pm-required', pm: null, pmId: null })
    expect(cleared.record).toMatchObject({ action: 'clear-pm', pmBefore: 'pm', pmAfter: null })
    expect(await projectText(t)).not.toContain('- PM:')
    const set = ok(await t.svc.setPm({ id: 'app', pm: 'pm' }))
    expect(set.project.state).toBe('ready')
    expect(ok(await t.svc.archive({ id: 'app' })).project.state).toBe('archived')
  })
  it('rejects non-PM titles, unknown employees, CEO/COO and malformed ids', async () => {
    const t = await setup({ projectMd: null })
    await addRepo(t, 'app')
    expect(code(await t.svc.setPm({ id: 'app', pm: 'developer' }))).toBe('invalid-request')
    expect(code(await t.svc.setPm({ id: 'app', pm: 'ghost' }))).toBe('not-found')
    expect(code(await t.svc.setPm({ id: 'app', pm: 'coo' }))).toBe('not-found')
    expect(code(await t.svc.setPm({ id: 'app', pm: 'ceo' }))).toBe('not-found')
    expect(code(await t.svc.setPm({ id: 'app', pm: 'a b' }))).toBe('invalid-request')
    expect(code(await t.svc.setPm({ id: 'app', pm: 'pm', extra: 1 }))).toBe('invalid-request')
    expect(await projectText(t)).not.toContain('- PM:')
    const dir = await makeDir(t.ws, 'x', true)
    expect(
      code(await t.svc.add({ path: await pick(t.svc, dir), name: 'X', pm: 'developer' }))
    ).toBe('invalid-request')
  })
  it('rejects an agent titled COO/CEO as forbidden', async () => {
    const t = await setup({ projectMd: null })
    await addRepo(t, 'app')
    const org = await readFile(join(t.c.dir, 'company/org.md'), 'utf8')
    await writeFile(
      join(t.c.dir, 'company/org.md'),
      org.replace('| PM            | `pm`  ', '| COO           | `pm`  ')
    )
    const r = await t.svc.setPm({ id: 'app', pm: 'pm' })
    expect(['forbidden', 'not-found', 'invalid-request']).toContain(code(r))
    expect(r.ok).toBe(false)
  })
  it('turns a broken PM reference into pm-required instead of an error (retired PM)', async () => {
    const t = await setup({ projectMd: null })
    const dir = await makeDir(t.ws, 'app', true)
    ok(await t.svc.add({ path: await pick(t.svc, dir), name: 'App', pm: 'pm' }))
    expect(ok(await t.svc.listPmRequired())).toEqual([])
    expect((await removeMember(t.c.fs, 'pm')).ok).toBe(true)
    const list = ok(await t.svc.list())
    expect(list.items[0]).toMatchObject({ state: 'pm-required', pmId: 'pm', pm: null })
    const required = ok(await t.svc.listPmRequired())
    expect(required.map((p: ProjectInfo) => p.id)).toEqual(['app'])
    // 보관된 프로젝트는 PM이 없어도 "PM 필요" 목록에 오르지 않는다.
    ok(await t.svc.archive({ id: 'app' }))
    expect(ok(await t.svc.listPmRequired())).toEqual([])
  })
  it('keeps several projects under the same PM', async () => {
    const t = await setup({ projectMd: null })
    await addRepo(t, 'one', { pm: 'pm' })
    await addRepo(t, 'two', { pm: 'pm' })
    expect(ok(await t.svc.list()).items.map((p) => p.state)).toEqual(['ready', 'ready'])
  })
})

describe('write safety', () => {
  const wrap =
    (hook: (rel: string, n: number) => Promise<void>, onWrite?: (n: number) => string | null) =>
    (fs: ProjectTest['c']['fs']): ProjectTest['c']['fs'] => {
      const w = Object.create(fs) as ProjectTest['c']['fs']
      let reads = 0
      let writes = 0
      w.readText = async (rel: string) => {
        if (rel === PROJECT_FILE) await hook(rel, ++reads)
        return fs.readText(rel)
      }
      w.writeText = async (rel: string, content: string, overwrite?: boolean) => {
        const alt = rel === PROJECT_FILE ? (onWrite?.(++writes) ?? null) : null
        return fs.writeText(rel, alt ?? content, overwrite)
      }
      return w
    }
  it('refuses to overwrite when the file changed between read and write (conflict)', async () => {
    let dir = ''
    const t = await setup({
      projectMd: '# 프로젝트 설정\n',
      wrapFs: wrap(async (_r, n) => {
        if (n === 2) await writeFile(join(dir, PROJECT_FILE), '# 누군가 고침\n')
      })
    })
    dir = t.c.dir
    const d = await makeDir(t.ws, 'app', true)
    const r = await t.svc.add({ path: await pick(t.svc, d), name: 'App' })
    expect(code(r)).toBe('conflict')
    expect(r.ok ? '' : r.message).not.toMatch(/project\.md|\.sh/)
    expect(await projectText(t)).toBe('# 누군가 고침\n')
  })
  it('does not clobber a project.md that appeared while creating it', async () => {
    let dir = ''
    const t = await setup({
      projectMd: null,
      wrapFs: wrap(
        async () => undefined,
        (n) => {
          if (n === 1) void writeFile(join(dir, PROJECT_FILE), 'racing\n')
          return null
        }
      )
    })
    dir = t.c.dir
    const d = await makeDir(t.ws, 'app', true)
    const r = await t.svc.add({ path: await pick(t.svc, d), name: 'App' })
    expect(r.ok === false || (await projectText(t)).includes('프로젝트: App')).toBe(true)
  })
  it('rolls back when the written content cannot be verified', async () => {
    const t = await setup({
      projectMd: '# 프로젝트 설정\n',
      wrapFs: wrap(
        async () => undefined,
        (n) => (n === 1 ? '# 깨진 내용\n' : null)
      )
    })
    const d = await makeDir(t.ws, 'app', true)
    expect(code(await t.svc.add({ path: await pick(t.svc, d), name: 'App' }))).toBe('internal')
    expect(await projectText(t)).toBe('# 프로젝트 설정\n')
  })
  it('removes the newly created file when verification fails', async () => {
    const t = await setup({
      projectMd: null,
      wrapFs: wrap(
        async () => undefined,
        (n) => (n === 1 ? 'broken\n' : null)
      )
    })
    const d = await makeDir(t.ws, 'app', true)
    expect(code(await t.svc.add({ path: await pick(t.svc, d), name: 'App' }))).toBe('internal')
    expect(await projectText(t).catch(() => null)).toBeNull()
  })
  it('serializes concurrent changes without losing either', async () => {
    const t = await setup({ projectMd: null })
    const a = await makeDir(t.ws, 'a', true)
    const b = await makeDir(t.ws, 'b', true)
    const pa = await pick(t.svc, a)
    const pb = await pick(t.svc, b)
    const [r1, r2] = await Promise.all([
      t.svc.add({ path: pa, name: 'A' }),
      t.svc.add({ path: pb, name: 'B' })
    ])
    expect([code(r1), code(r2)]).toEqual(['ok', 'ok'])
    expect(ok(await t.svc.list()).items.map((p) => p.id)).toEqual(['a', 'b'])
  })
  it('never exposes internal paths in failures', async () => {
    const t = await setup({ projectMd: null })
    const d = await makeDir(t.ws, 'plain', false)
    const r = await t.svc.add({ path: await pick(t.svc, d), name: 'P' })
    expect(JSON.stringify(r)).not.toContain(t.ws)
  })
})

describe('git probing', () => {
  const recorder = (
    outcome: (args: readonly string[]) => GitOutcome
  ): { run: GitRunner; calls: string[][] } => {
    const calls: string[][] = []
    return {
      calls,
      run: async (args) => {
        calls.push([...args])
        return outcome(args)
      }
    }
  }
  it('uses only read-only commands', async () => {
    const g = recorder((args) =>
      args[0] === 'status'
        ? { kind: 'done', code: 0, stdout: '' }
        : { kind: 'done', code: 0, stdout: args.includes('--show-toplevel') ? '' : 'main\n' }
    )
    const t = await setup({ projectMd: null, git: g.run })
    const d = await makeDir(t.ws, 'app', true)
    g.run(['rev-parse'], d, 1)
    await t.svc.add({ path: await pick(t.svc, d), name: 'App' })
    await t.svc.list()
    expect(g.calls.length).toBeGreaterThan(1)
    for (const c of g.calls) {
      expect(['rev-parse', 'status']).toContain(c[0])
      if (c[0] === 'status') expect(c).toEqual(['status', '--porcelain'])
    }
  })
  it('shows unavailable on timeout and keeps the list usable', async () => {
    const g = recorder(() => ({ kind: 'timeout' }))
    const t = await setup({ projectMd: null, git: g.run })
    const d = await makeDir(t.ws, 'app', true)
    // git을 실행하지 못해도 `.git` 존재로 추가는 된다.
    ok(await t.svc.add({ path: await pick(t.svc, d), name: 'App' }))
    // git 없이도 `.git/HEAD`로 브랜치는 읽는다 (dirty는 모른다).
    const git = ok(await t.svc.list()).items[0].git
    expect(git.status).toBe('unavailable')
    expect(git).toHaveProperty('branch', expect.any(String))
    expect(git).not.toHaveProperty('dirty')
  })
  it('falls back to .git/HEAD when git is not runnable', async () => {
    const t = await setup({ projectMd: null, git: async () => ({ kind: 'unavailable' }) })
    const d = await makeDir(t.ws, 'app', true)
    ok(await t.svc.add({ path: await pick(t.svc, d), name: 'App' }))
    await writeFile(join(d, '.git', 'HEAD'), 'ref: refs/heads/feature/x\n')
    expect(ok(await t.svc.list()).items[0].git).toEqual({
      status: 'unavailable',
      branch: 'feature/x'
    })
    await writeFile(join(d, '.git', 'HEAD'), '0123456789abcdef0123456789abcdef01234567\n')
    expect(ok(await t.svc.list()).items[0].git).toEqual({ status: 'unavailable', branch: null })
  })
  it('skips git entirely for a folder without .git even inside another repo', async () => {
    const g = recorder(() => ({ kind: 'done', code: 0, stdout: '' }))
    const t = await setup({ projectMd: null, git: g.run })
    const repo = await makeDir(t.ws, 'repo', true)
    const sub = await makeDir(repo, 'posts', false)
    ok(await t.svc.add({ path: await pick(t.svc, sub), name: 'Posts', type: 'content' }))
    g.calls.length = 0
    expect(ok(await t.svc.list()).items[0].git).toEqual({ status: 'not-repo' })
    expect(g.calls).toEqual([])
  })
})

describe('project:add default branch detection (T-062)', () => {
  const runner =
    (develop: boolean, current: string | null): GitRunner =>
    async (args) => {
      const a = args.join(' ')
      if (a.startsWith('rev-parse --show-toplevel')) return { kind: 'unavailable' }
      if (a.startsWith('show-ref')) return { kind: 'done', code: develop ? 0 : 1, stdout: '' }
      if (a.startsWith('symbolic-ref'))
        return current === null
          ? { kind: 'done', code: 128, stdout: '' }
          : { kind: 'done', code: 0, stdout: `${current}\n` }
      return { kind: 'unavailable' }
    }
  async function branchLine(git: GitRunner, extra: Record<string, unknown> = {}): Promise<string> {
    const t = await setup({ projectMd: null, git })
    await addRepo(t, 'app', extra)
    return (await projectText(t)).split('\n').find((l) => l.startsWith('- 기본 브랜치:')) ?? ''
  }
  it('prefers develop, then the current branch', async () => {
    expect(await branchLine(runner(true, 'feature/x'))).toBe('- 기본 브랜치: develop')
    expect(await branchLine(runner(false, 'trunk'))).toBe('- 기본 브랜치: trunk')
  })
  it('falls back to an internal default when nothing can be determined', async () => {
    expect(await branchLine(runner(false, null))).toBe('- 기본 브랜치: main')
  })
  it('keeps an explicit value and does not write dev command', async () => {
    expect(await branchLine(runner(true, null), { defaultBranch: 'release' })).toBe(
      '- 기본 브랜치: release'
    )
    const t = await setup({ projectMd: null, git: runner(true, null) })
    await addRepo(t, 'app')
    expect(await projectText(t)).not.toContain('dev 명령')
  })
  it('does not record a branch for non-development types', async () => {
    const t = await setup({ projectMd: null, git: runner(true, 'x') })
    const dir = await makeDir(t.ws, 'docs', false)
    ok(await t.svc.add({ path: await pick(t.svc, dir), name: 'docs', type: 'content' }))
    expect(await projectText(t)).not.toContain('기본 브랜치')
  })
})

describe('project:add keeps existing project.md lines (T-062)', () => {
  it('only appends a block; existing lines stay byte-identical and the branch round-trips', async () => {
    const t = await setup({ git: async () => ({ kind: 'unavailable' }) })
    const before = await projectText(t)
    await addRepo(t, 'newapp')
    const after = await projectText(t)
    expect(after.startsWith(before.trimEnd())).toBe(true)
    const p = ok(await t.svc.list()).items.find((i) => i.id === 'newapp')
    expect(p?.defaultBranch).toBe('main')
  })
})

describe('project errors hide file names (T-062)', () => {
  it('does not mention project.md when the settings grow too large', async () => {
    const t = await setup({ projectMd: `# 프로젝트 설정\n${'x'.repeat(1024 * 1024 + 10)}\n` })
    const d = await makeDir(t.ws, 'app', true)
    const r = await t.svc.add({ path: await pick(t.svc, d), name: 'App' })
    expect(r.ok).toBe(false)
    expect(r.ok ? '' : r.message).not.toMatch(/project\.md/)
  })
})
