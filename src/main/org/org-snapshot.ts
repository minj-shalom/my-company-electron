import type { OrgAgentDetail, OrgSnapshot } from '../../shared/org'
import { splitFrontmatter, asString } from '../repository/markdown'
import { AGENTS_DIR } from '../repository/parse-org'
import type { SafeFs } from '../repository/safe-fs'
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

/** `org:get` 본문. 조직 모델과, 직원 파일이 있는 에이전트의 frontmatter 상세를 합친다. */
export async function buildOrgSnapshot(fs: SafeFs): Promise<OrgSnapshot> {
  const org = await loadOrg(fs)
  const ids = org.members
    .filter((m) => m.kind === 'agent' && m.fileExists && m.agentId !== null)
    .map((m) => m.agentId as string)
  const agents = await Promise.all([...new Set(ids)].map((id) => readAgent(fs, id)))
  return { org, agents }
}
