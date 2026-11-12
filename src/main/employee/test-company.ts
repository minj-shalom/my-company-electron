import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { FileCompanyRepository } from '../repository/file-repository'
import { SafeFs } from '../repository/safe-fs'
import {
  EmployeeService,
  type AssignmentSource,
  type EmployeeServiceDeps
} from './employee-service'

const FIXTURES = join(__dirname, 'fixtures')
const DECISIONS = join(__dirname, '..', 'repository', 'fixtures', 'decisions')

/** 이 회사의 실제 org.md와 `.claude/agents/` 사본, 결정 카드(D-001 done, D-016 pending)로 만든 테스트 회사. */
export interface TestCompany {
  dir: string
  fs: SafeFs
  repo: FileCompanyRepository
  service: EmployeeService
}

export async function put(dir: string, rel: string, content: string): Promise<void> {
  const abs = join(dir, rel)
  await mkdir(dirname(abs), { recursive: true })
  await writeFile(abs, content)
}

export async function makeCompany(
  extra: Partial<EmployeeServiceDeps> & { assignments?: AssignmentSource } = {}
): Promise<TestCompany> {
  const dir = await mkdtemp(join(tmpdir(), 'mc-emp-'))
  await put(dir, 'CLAUDE.md', '# c\n')
  await put(dir, 'company/org.md', await readFile(join(FIXTURES, 'real-org.md'), 'utf8'))
  for (const f of await readdir(join(FIXTURES, 'agents')))
    await put(dir, `.claude/agents/${f}`, await readFile(join(FIXTURES, 'agents', f), 'utf8'))
  await put(
    dir,
    'company/decisions/done/D-001-initial-decisions.md',
    await readFile(join(DECISIONS, 'D-001-initial-decisions.md'), 'utf8')
  )
  await put(
    dir,
    'company/decisions/done/D-012-headless-permission-policy.md',
    await readFile(join(DECISIONS, 'D-012-headless-permission-policy.md'), 'utf8')
  )
  await put(
    dir,
    'company/decisions/pending/D-016-weekly-limit-unit.md',
    await readFile(join(DECISIONS, 'D-016-weekly-limit-unit.md'), 'utf8')
  )
  const fs = await SafeFs.open(dir)
  const repo = FileCompanyRepository.fromSafeFs(fs)
  const service = new EmployeeService({
    fs,
    exclusive: (t) => repo.runExclusive(t),
    isApproved: async (id) => {
      const d = await repo.getDecision(id)
      return d.ok && d.value.status === 'done' && d.value.chosen !== null
    },
    now: () => new Date('2026-11-13T00:00:00.000Z'),
    ...extra
  })
  return { dir, fs, repo, service }
}

export const orgText = (c: TestCompany): Promise<string> =>
  readFile(join(c.dir, 'company/org.md'), 'utf8')
export const agentText = (c: TestCompany, id: string): Promise<string> =>
  readFile(join(c.dir, `.claude/agents/${id}.md`), 'utf8')

/** 모든 직원 파일의 이름 -> 내용. */
export async function snapshotAgents(c: TestCompany): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const f of (await readdir(join(c.dir, '.claude/agents'))).sort())
    out[f] = await readFile(join(c.dir, '.claude/agents', f), 'utf8')
  return out
}
