import { BASE_ROLES, type OrgAgentDetail, type OrgModel, type OrgSnapshot } from '../../shared/org'
import { splitFrontmatter, asString } from '../repository/markdown'
import { AGENTS_DIR } from '../repository/parse-org'
import type { SafeFs } from '../repository/safe-fs'
import { readProjectItems, validateAssignments } from '../project/assignments-store'
import { loadOrg } from './org-store'

/** frontmatter `tools`는 콤마 문자열이거나 YAML 목록일 수 있다. */
function parseTools(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : []
  return raw
    .filter((t): t is string => typeof t === 'string')
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
}

async function readAgent(fs: SafeFs, id: string): Promise<OrgAgentDetail> {
  try {
    const { data } = splitFrontmatter(await fs.readText(`${AGENTS_DIR}/${id}.md`))
    return {
      id,
      name: asString(data.name) ?? id,
      description: asString(data.description) ?? '',
      model: asString(data.model),
      tools: parseTools(data.tools)
    }
  } catch {
    // 파일 하나가 깨져도 조직도 전체는 보여준다. 원본 오류에는 경로가 있을 수 있어 버린다.
    return { id, name: id, description: '', model: null, tools: [] }
  }
}

const READ_CONCURRENCY = 8

async function mapLimited<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array<R>(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

/** 직급이나 직원 파일 id 어느 쪽으로든 이미 있으면 빠진 것이 아니다. */
export function findMissingBaseRoles(org: OrgModel): OrgSnapshot['missingBaseRoles'] {
  if (org.members.length === 0) return []
  return BASE_ROLES.filter(
    (r) => !org.members.some((m) => m.title === r.title || m.agentId === r.id)
  ).map((r) => r.id)
}

/** `org:get` 본문. 조직 모델과, 직원 파일이 있는 에이전트의 frontmatter 상세를 합친다. */
export async function buildOrgSnapshot(fs: SafeFs): Promise<OrgSnapshot> {
  const org = await loadOrg(fs)
  const ids = org.members
    .filter((m) => m.kind === 'agent' && m.fileExists && m.agentId !== null)
    .map((m) => m.agentId as string)
  const details = await mapLimited([...new Set(ids)], READ_CONCURRENCY, (id) => readAgent(fs, id))
  // project.md를 읽지 못해도 조직도는 보여준다 (배정 없음으로 취급).
  const items = await readProjectItems(fs).catch(() => [])
  const { byEmployee, issues } = validateAssignments(items, org)
  const agents = details.map((a) => ({
    ...a,
    projects: (byEmployee.get(a.id) ?? []).map((e) => ({
      id: e.projectId,
      name: e.projectName,
      role: e.role,
      active: e.active
    }))
  }))
  return {
    org,
    agents,
    missingBaseRoles: findMissingBaseRoles(org),
    ...(issues.length > 0 ? { assignmentIssues: issues } : {})
  }
}
