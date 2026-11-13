import { EMPLOYEE_MODELS, MAX_EMPLOYEE_BODY_BYTES } from '../../shared/employee-change'
import type { IntegrityIssue, IntegrityIssueCode } from '../../shared/integrity'
import type { OrgModel } from '../../shared/org'
import { isPmMember } from '../../shared/project'
import { checkTools, readTools } from '../employee/agent-file'
import { chartMismatches } from '../org/org-chart'
import { parseOrgDocument } from '../org/parse-org-doc'
import { parseFieldLine, parsePmValue } from '../project/field-lines'
import { parseProjectDoc, type ProjectDoc } from '../project/project-doc'
import { splitFrontmatter } from '../repository/markdown'
import { ORG, PROJECT, agentIdOf, isAgentPath, type FileMap } from './protected-files'

const issue = (
  code: IntegrityIssueCode,
  file: string,
  message: string,
  severity: IntegrityIssue['severity'] = 'violation'
): IntegrityIssue => ({ code, file, message, severity })

export const agentIdsOf = (files: FileMap): Set<string> =>
  new Set([...files.keys()].filter(isAgentPath).map(agentIdOf))

export function orgModelOf(files: FileMap): OrgModel | null {
  const text = files.get(ORG)?.text
  return typeof text === 'string' ? parseOrgDocument(text, agentIdsOf(files)) : null
}

const keyOf = (i: { code: string; message: string }): string => `${i.code}:${i.message}`

/** org.md 검증. 기준(정상) 상태에도 있던 문제는 새 문제가 아니므로 제외한다. */
export function validateOrg(before: FileMap | null, after: FileMap): IntegrityIssue[] {
  const cur = orgModelOf(after)
  if (cur === null) return after.has(ORG) ? [] : [issue('missing-org', ORG, 'org.md가 없습니다.')]
  const prev = before === null ? null : orgModelOf(before)
  const known = new Set(prev === null ? [] : prev.issues.map(keyOf))
  const found: Array<{ code: IntegrityIssueCode; message: string }> = cur.issues.map((i) => ({
    code: i.code,
    message: i.message
  }))
  for (const m of chartMismatches(cur)) found.push({ code: 'chart-mismatch', message: m })
  const knownChart = new Set(
    prev === null ? [] : chartMismatches(prev).map((m) => `chart-mismatch:${m}`)
  )
  return found
    .filter((i) => !known.has(keyOf(i)) && !knownChart.has(keyOf(i)))
    .map((i) => issue(i.code, ORG, i.message))
}

/** 직원 파일 한 개 검증 (frontmatter, name, model, tools, 본문 크기). */
export function validateAgentFile(rel: string, text: string): IntegrityIssue[] {
  const out: IntegrityIssue[] = []
  let parsed: ReturnType<typeof splitFrontmatter>
  try {
    parsed = splitFrontmatter(text)
  } catch {
    return [issue('agent-unparsable', rel, 'frontmatter를 읽을 수 없습니다.')]
  }
  const { data, body } = parsed
  if (Object.keys(data).length === 0)
    return [issue('agent-unparsable', rel, 'frontmatter가 없습니다.')]
  if (data.name !== agentIdOf(rel))
    out.push(issue('agent-name-mismatch', rel, 'name이 파일 이름과 다릅니다.'))
  if (
    data.model !== undefined &&
    !(EMPLOYEE_MODELS as readonly string[]).includes(String(data.model))
  )
    out.push(issue('agent-model', rel, '허용되지 않는 model입니다.'))
  if ('tools' in data && !checkTools(readTools(data.tools)).ok)
    out.push(issue('agent-tools', rel, 'tools 형식이 올바르지 않습니다.'))
  if (Buffer.byteLength(body, 'utf8') > MAX_EMPLOYEE_BODY_BYTES)
    out.push(issue('agent-body-size', rel, '본문이 너무 큽니다.'))
  return out
}

export function validateAgentFiles(before: FileMap | null, after: FileMap): IntegrityIssue[] {
  const out: IntegrityIssue[] = []
  for (const [rel, st] of after) {
    if (!isAgentPath(rel) || before?.get(rel)?.hash === st.hash) continue
    if (st.text === null) out.push(issue('file-too-large', rel, '직원 파일을 읽을 수 없습니다.'))
    else out.push(...validateAgentFile(rel, st.text))
  }
  return out
}

/** 블록에서 `직원:`·`PM:` 줄을 뺀 나머지 줄. 이 부분이 달라지면 허용 범위 밖 변경이다. */
function stripAssignmentLines(lines: string[]): string[] {
  return lines.filter((l) => {
    const f = parseFieldLine(l)
    return f === null || (f.key !== '직원' && f.key !== 'PM')
  })
}

type Block = Extract<ProjectDoc['segments'][number], { kind: 'block' }>
const blocksOf = (doc: ProjectDoc): Block[] =>
  doc.segments.filter((s): s is Block => s.kind === 'block')
const rawOf = (doc: ProjectDoc): string =>
  doc.segments.map((s) => (s.kind === 'raw' ? s.lines.join('\n') : '\u0000block')).join('\n')

function pmLineProblem(block: Block): IntegrityIssueCode | null {
  const pm = block.rawLines.map(parseFieldLine).filter((f) => f !== null && f.key === 'PM')
  if (pm.length > 1) return 'pm-duplicate'
  const v = pm[0]?.value
  if (v !== undefined && v !== '' && parsePmValue(v) === null) return 'pm-format'
  return null
}

/**
 * project.md 줄 단위 diff 검증. 바뀐 줄이 프로젝트 블록의 `직원:`·`PM:` 줄뿐이어야 하고,
 * 그 값은 org.md 기준으로 유효해야 한다. PM이 사라진 것은 위반이 아니라 상태 변화(`pm-needed`)다.
 */
export function validateProjectFile(before: FileMap, after: FileMap): IntegrityIssue[] {
  const b = before.get(PROJECT)
  const a = after.get(PROJECT)
  if (b?.hash === a?.hash) return pmGone(before, after)
  if (a === undefined)
    return [issue('project-line-changed', PROJECT, 'project.md가 삭제되었습니다.')]
  if (a.text === null)
    return [issue('project-line-changed', PROJECT, 'project.md를 읽을 수 없습니다.')]
  if (b === undefined || b.text === null)
    return [issue('project-line-changed', PROJECT, 'project.md가 새로 만들어졌습니다.')]

  const docB = parseProjectDoc(b.text)
  const docA = parseProjectDoc(a.text)
  const bb = blocksOf(docB)
  const ba = blocksOf(docA)
  const out: IntegrityIssue[] = []
  const changed = (msg: string): void => {
    out.push(issue('project-line-changed', PROJECT, msg))
  }
  if (bb.length === 0 || ba.length === 0 || docB.legacy !== null || docA.legacy !== null) {
    // 기존 단일 형식에는 배정 줄이 없다. 어떤 변경이든 허용 범위 밖이다.
    if (b.text !== a.text) changed('프로젝트 설정이 바뀌었습니다.')
    return out
  }
  if (bb.length !== ba.length)
    return [issue('project-line-changed', PROJECT, '프로젝트가 추가되거나 삭제되었습니다.')]
  if (rawOf(docB) !== rawOf(docA)) changed('프로젝트 블록 밖의 줄이 바뀌었습니다.')

  const orgAfter = orgModelOf(after)
  const agentsBefore = agentIdsOf(before)
  const agentsAfter = agentIdsOf(after)
  ba.forEach((blk, i) => {
    const old = bb[i]
    const name = blk.rawLines[0].slice(0, 80)
    if (
      JSON.stringify(stripAssignmentLines(old.rawLines)) !==
      JSON.stringify(stripAssignmentLines(blk.rawLines))
    ) {
      changed(`프로젝트 설정 줄이 바뀌었습니다 (${name}).`)
      return
    }
    const dup = pmLineProblem(blk)
    if (dup !== null) {
      out.push(issue(dup, PROJECT, 'PM 줄이 올바르지 않습니다 (중복 또는 형식 오류).'))
      return
    }
    if (blk.project === null) {
      if (old.project !== null)
        out.push(
          issue('project-block-unreadable', PROJECT, '바뀐 프로젝트 블록을 읽을 수 없습니다.')
        )
      return
    }
    const members = blk.project.memberIds
    const unknown = members.filter((id) => !agentsAfter.has(id) || !orgHas(orgAfter, id))
    if (unknown.length > 0 && !sameMembers(old, members))
      out.push(issue('assignee-unknown', PROJECT, '조직도에 없는 직원이 배정되었습니다.'))
    const pm = blk.project.pmId
    const oldPm = old.project?.pmId ?? null
    if (pm !== null && !isPmMember(orgAfter, pm)) {
      // 직전까지 있던 직원이 퇴사·보관되어 사라진 것은 위반이 아니라 "PM 필요" 상태 변화다.
      if (pm === oldPm && agentsBefore.has(pm) && !agentsAfter.has(pm))
        out.push(issue('pm-needed', PROJECT, 'PM이 없어 PM 지정이 필요합니다.', 'info'))
      else if (orgHas(orgAfter, pm) && agentsAfter.has(pm))
        out.push(issue('pm-not-pm', PROJECT, 'PM 직급이 아닌 직원이 PM으로 지정되었습니다.'))
      else out.push(issue('pm-unknown', PROJECT, '조직도에 없는 직원이 PM으로 지정되었습니다.'))
    } else if (pm === null && oldPm !== null) {
      out.push(issue('pm-needed', PROJECT, 'PM이 없어 PM 지정이 필요합니다.', 'info'))
    }
  })
  return out
}

/** project.md는 그대로인데 PM 직원이 퇴사·보관되어 PM이 없는 상태가 된 경우 (위반 아님, 상태 변화). */
function pmGone(before: FileMap, after: FileMap): IntegrityIssue[] {
  const text = after.get(PROJECT)?.text
  if (typeof text !== 'string') return []
  const orgBefore = orgModelOf(before)
  const orgAfter = orgModelOf(after)
  const gone = blocksOf(parseProjectDoc(text)).some((blk) => {
    const pm = blk.project?.pmId ?? null
    return pm !== null && isPmMember(orgBefore, pm) && !isPmMember(orgAfter, pm)
  })
  return gone ? [issue('pm-needed', PROJECT, 'PM이 없어 PM 지정이 필요합니다.', 'info')] : []
}

function orgHas(org: OrgModel | null, id: string): boolean {
  return org !== null && org.members.some((m) => m.kind === 'agent' && m.agentId === id)
}

/** 이미 있던 배정(기준 상태에도 있던 id)은 새 위반으로 세지 않는다. */
function sameMembers(old: Block, now: string[]): boolean {
  const prev = old.project?.memberIds ?? []
  return now.every((id) => prev.includes(id))
}

export function validateAll(before: FileMap | null, after: FileMap): IntegrityIssue[] {
  return [
    ...validateOrg(before, after),
    ...validateAgentFiles(before, after),
    ...(before === null ? [] : validateProjectFile(before, after))
  ]
}
