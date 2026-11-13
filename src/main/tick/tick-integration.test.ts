import { spawnSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PolicyService } from '../policy/policy-service'
import { ClaudeAdapter } from '../providers/claude/claude-adapter'
import { makeProjectTest, type ProjectTest } from '../project/test-project-company'
import { createTickRunner } from './tick-runner'
import { policyState, project, snapshot, ticket } from './tick-test-kit'
import type { TickDeps } from './tick-types'

/**
 * 가짜 claude 실행 파일로 실제 spawn 경로(cwd, 인자 배열, 종료 처리)를 검증한다.
 * 프로젝트 폴더는 실제 임시 git 레포라 cwd가 틀리면 `git rev-parse`가 다른 값을 낸다.
 */
const cleanup: string[] = []
const tests: ProjectTest[] = []
afterEach(async () => {
  for (const t of tests.splice(0))
    for (const d of t.dirs) await rm(d, { recursive: true, force: true })
  for (const d of cleanup.splice(0)) await rm(d, { recursive: true, force: true })
})

const RESULT =
  '{"type":"result","subtype":"success","is_error":false,"num_turns":1,"result":"done","total_cost_usd":0.01,"duration_ms":5}'

async function setup(script: (out: string) => string): Promise<{
  t: ProjectTest
  repoDir: string
  out: string
  bin: string
}> {
  const t = await makeProjectTest()
  tests.push(t)
  const work = await realpath(await mkdtemp(join(tmpdir(), 'mc-tick-')))
  cleanup.push(work)
  const repoDir = join(work, 'repo')
  await mkdir(repoDir)
  spawnSync('git', ['init', '-q'], { cwd: repoDir })
  const out = join(work, 'out')
  await mkdir(out)
  const bin = join(work, 'claude')
  await writeFile(bin, script(out))
  await chmod(bin, 0o755)
  return { t, repoDir, out, bin }
}

const OK_SCRIPT = (out: string): string => `#!/bin/sh
pwd -P > "${out}/cwd"
git rev-parse --show-toplevel > "${out}/toplevel"
printf '%s\\0' "$@" > "${out}/args"
echo '${RESULT}'
`

function depsFor(
  s: { t: ProjectTest; repoDir: string; bin: string; out: string },
  extra: Partial<TickDeps> = {}
): TickDeps {
  const policies = new PolicyService({ fs: s.t.c.fs, exclusive: (x) => s.t.c.repo.runExclusive(x) })
  return {
    now: () => new Date('2026-11-13T10:00:00.000Z'),
    companyDir: () => s.t.c.dir,
    loadSnapshot: async () =>
      snapshot({
        tickets: [
          ticket('T-001', {
            projectId: 'my-company',
            body: `$(touch ${s.out}/pwned) \`id\` ; --flag`
          })
        ],
        projects: [project('my-company')]
      }),
    loadPolicy: async (id) => {
      const r = await policies.get({ projectId: id })
      return r.ok ? r.value : null
    },
    readAgentPrompt: async () => null,
    resolveProjectDir: async () => s.repoDir,
    createAdapter: (cwd) => new ClaudeAdapter({ cwd, command: s.bin }),
    writeReport: async (id, md) => {
      const r = await s.t.c.repo.createReport(id, md)
      if (r.ok) return 'written'
      if (r.code === 'conflict') return 'exists'
      throw new Error('write failed')
    },
    createCard: async () => 'D-900',
    isKillSwitchEngaged: async () => false,
    checkLimit: async () => ({ ok: true, reason: '' }),
    ...extra
  }
}

const ctx = (
  signal = new AbortController().signal
): Parameters<ReturnType<typeof createTickRunner>>[0] => ({
  trigger: 'run-now',
  allowedProjectIds: null,
  signal
})

describe('tick runner with a fake claude executable', () => {
  it('spawns in the project git repo with an argument array and writes the briefing', async () => {
    const s = await setup(OK_SCRIPT)
    await createTickRunner(depsFor(s))(ctx())
    expect((await readFile(join(s.out, 'cwd'), 'utf8')).trim()).toBe(s.repoDir)
    expect((await readFile(join(s.out, 'toplevel'), 'utf8')).trim()).toBe(s.repoDir)
    const args = (await readFile(join(s.out, 'args'), 'utf8')).split('\0').slice(0, -1)
    expect(args.slice(0, 4)).toEqual(['-p', '--output-format', 'stream-json', '--verbose'])
    expect(args[args.length - 2]).toBe('--')
    // 셸을 거치지 않으므로 티켓 본문의 메타문자는 그대로 하나의 인자에 들어 있고 실행되지 않는다.
    expect(args[args.length - 1]).toContain(`$(touch ${s.out}/pwned) \`id\` ; --flag`)
    expect(existsSync(join(s.out, 'pwned'))).toBe(false)
    const reports = await s.t.c.repo.listReports()
    const b = reports.items.find((r) => r.id === 'briefing-20261113100000')
    expect(b?.body).toContain('- **결과:** 완료')
    expect(b?.body).toContain('done')
  })

  it('keeps the immutable rules even when the policy file tries to relax them', async () => {
    const s = await setup(OK_SCRIPT)
    await mkdir(join(s.t.c.dir, 'company/policies'), { recursive: true })
    await writeFile(
      join(s.t.c.dir, 'company/policies', 'my-company.md'),
      '# 정책: my-company\n\n- 강제 푸시: 허용\n- 프로젝트 밖 쓰기: 허용\n'
    )
    await createTickRunner(depsFor(s))(ctx())
    const args = (await readFile(join(s.out, 'args'), 'utf8')).split('\0')
    const prompt = args[args.length - 2]
    expect(prompt).toContain('강제 푸시와 히스토리 재작성')
    expect(prompt).not.toContain('강제 푸시: 허용')
    expect(prompt).toContain('푸시 승인 모드: 매번 컨펌')
  })

  it('cleans up after a timeout: the child is killed, the briefing says so, the next tick works', async () => {
    const s = await setup((out) => `#!/bin/sh\necho $$ > "${out}/pid"\nexec sleep 30\n`)
    const deps = depsFor(s, { timeoutMs: 1000 })
    await expect(createTickRunner(deps)(ctx())).rejects.toThrow('tick-timeout')
    const pid = Number((await readFile(join(s.out, 'pid'), 'utf8')).trim())
    expect(() => process.kill(pid, 0)).toThrow()
    const b = (await s.t.c.repo.listReports()).items.find((r) => r.id.startsWith('briefing-'))
    expect(b?.body).toContain('시간 초과')
    await writeFile(s.bin, OK_SCRIPT(s.out))
    await expect(
      createTickRunner({ ...deps, now: () => new Date('2026-11-13T11:00:00.000Z') })(ctx())
    ).resolves.toBeUndefined()
  }, 15_000)

  it('cancels the child when the signal aborts', async () => {
    const s = await setup((out) => `#!/bin/sh\necho $$ > "${out}/pid"\nexec sleep 30\n`)
    const ac = new AbortController()
    const run = createTickRunner(depsFor(s))(ctx(ac.signal))
    for (let i = 0; i < 100 && !existsSync(join(s.out, 'pid')); i++)
      await new Promise((r) => setTimeout(r, 20))
    ac.abort()
    await run
    const pid = Number((await readFile(join(s.out, 'pid'), 'utf8')).trim())
    expect(() => process.kill(pid, 0)).toThrow()
    const b = (await s.t.c.repo.listReports()).items.find((r) => r.id.startsWith('briefing-'))
    expect(b?.body).toContain('취소됨')
  }, 15_000)

  it('briefs a missing CLI as a failure and rethrows', async () => {
    const s = await setup(OK_SCRIPT)
    const deps = depsFor(s, {
      createAdapter: (cwd) => new ClaudeAdapter({ cwd, command: join(cwd, 'no-such-claude') })
    })
    await expect(createTickRunner(deps)(ctx())).rejects.toThrow('tick-failed')
    const b = (await s.t.c.repo.listReports()).items.find((r) => r.id.startsWith('briefing-'))
    expect(b?.body).toContain('CLI를 찾지 못해')
  })

  it('reads the default policy when none exists (every)', async () => {
    const s = await setup(OK_SCRIPT)
    const state = policyState()
    expect(state.effective.modes.push).toBe('every')
    await createTickRunner(depsFor(s))(ctx())
    const args = (await readFile(join(s.out, 'args'), 'utf8')).split('\0')
    expect(args[args.length - 2]).toContain('푸시 승인 모드: 매번 컨펌')
  })
})
