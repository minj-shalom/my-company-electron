import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeCompany, type TestCompany } from '../employee/test-company'
import type { GitRunner } from './git-probe'
import { PROJECT_FILE, ProjectService, type InProgressSource } from './project-service'

export const FIXTURE_PROJECT_MD = join(__dirname, 'fixtures', 'real-project.md')

export interface ProjectTest {
  c: TestCompany
  /** 프로젝트 레포를 만들 작업 폴더 (회사 폴더 밖). */
  ws: string
  svc: ProjectService
  dirs: string[]
}

export async function makeProjectTest(
  opts: {
    projectMd?: string | null
    inProgress?: InProgressSource
    git?: GitRunner
    homeDir?: string
    wrapFs?: (fs: TestCompany['fs']) => TestCompany['fs']
  } = {}
): Promise<ProjectTest> {
  const c = await makeCompany()
  const ws = await realpath(await mkdtemp(join(tmpdir(), 'mc-proj-ws-')))
  if (opts.projectMd !== null)
    await writeFile(
      join(c.dir, PROJECT_FILE),
      opts.projectMd ?? (await readFile(FIXTURE_PROJECT_MD, 'utf8'))
    )
  const svc = new ProjectService({
    fs: opts.wrapFs ? opts.wrapFs(c.fs) : c.fs,
    exclusive: (t) => c.repo.runExclusive(t),
    inProgress: opts.inProgress ?? { list: async () => ({ tickets: [], unreadable: 0 }) },
    homeDir: opts.homeDir ?? '/nonexistent-home',
    git: opts.git,
    now: () => new Date('2026-11-13T00:00:00.000Z')
  })
  return { c, ws, svc, dirs: [c.dir, ws] }
}

/** 작업 폴더 안에 폴더를 만든다. `git`이 true면 `git init`까지 한다 (읽기 전용 조회 테스트용 실제 레포). */
export async function makeDir(ws: string, name: string, git: boolean): Promise<string> {
  const dir = join(ws, name)
  await mkdir(dir, { recursive: true })
  if (git) spawnSync('git', ['init', '-q'], { cwd: dir })
  return dir
}

export const projectText = (t: ProjectTest): Promise<string> =>
  readFile(join(t.c.dir, PROJECT_FILE), 'utf8')

/** 선택 다이얼로그를 거친 것으로 만든다. */
export async function pick(svc: ProjectService, dir: string): Promise<string> {
  const r = await svc.selectFolder(async () => dir)
  if (r === null) throw new Error('pick failed')
  return r
}
