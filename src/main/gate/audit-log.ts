import {
  AUDIT_RESULTS,
  type AuditFailure,
  type AuditProjectSummary,
  type AuditResult,
  type AuditSummary
} from '../../shared/gate'
import { LIMITED_ACTIONS, type LimitedAction } from '../../shared/policy'
import { PROJECT_ID } from '../../shared/project'
import { FsGuardError, type SafeFs } from '../repository/safe-fs'

export const AUDIT_DIR = 'company/audit'
const ROTATE_BYTES = 400 * 1024
const MAX_FAILURES = 50
const HEADER_ROW = '| 일시 | 동작 | 대상 | 결과 | 직원 | 티켓 | 모드 | 카운트 |'

export interface AuditEntry {
  at: Date
  action: LimitedAction
  /** 브랜치 또는 초안 경로에 짧은 해시를 붙인 값 (예: `feature/x@abc1234`). */
  target: string
  result: AuditResult
  employee: string
  ticket: string | null
  mode: 'auto' | 'fallback'
  /** 오늘 카운트와 상한 (예: `3/20`). 기록할 수 없으면 null. */
  count: string | null
}

/** 표 셀에 넣을 값에서 줄 구조를 깰 문자, URL 쿼리·사용자 정보, 토큰처럼 보이는 문자열을 걷어낸다. */
export function sanitizeCell(v: string): string {
  let out = ''
  for (const ch of v) {
    const c = ch.codePointAt(0) ?? 0
    out += c <= 0x1f || (c >= 0x7f && c <= 0x9f) || c === 0x2028 || c === 0x2029 ? ' ' : ch
  }
  return out
    .replace(/\/\/[^/@\s]*@/g, '//')
    .replace(/\?\S*/g, '')
    .replace(/\b(?:gh[pousr]_|github_pat_|sk-|xox[abp]-)[A-Za-z0-9_-]{8,}/g, '[redacted]')
    .replace(/\|/g, '/')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160)
}

export const auditPath = (projectId: string): string => `${AUDIT_DIR}/${projectId}.md`

export function formatAuditLine(e: AuditEntry): string {
  const cells = [
    e.at.toISOString(),
    e.action,
    e.target,
    e.result,
    e.employee,
    e.ticket ?? '-',
    e.mode === 'auto' ? '자동' : '대체',
    e.count ?? '-'
  ].map(sanitizeCell)
  return `| ${cells.join(' | ')} |`
}

export interface AuditLogDeps {
  fs: SafeFs
  exclusive: <T>(task: () => Promise<T>) => Promise<T>
}

/** 감사 기록은 앱만 추가한다 (에이전트는 `company/audit/**` 쓰기 deny, 변경은 T-052가 감지). 읽기 전용 목록과 요약은 같은 모듈이 만든다. */
export class AuditLog {
  constructor(private readonly deps: AuditLogDeps) {}

  async append(projectId: string, entry: AuditEntry): Promise<void> {
    if (!PROJECT_ID.test(projectId)) throw new Error('invalid-project')
    const rel = auditPath(projectId)
    const line = formatAuditLine(entry)
    await this.deps.exclusive(async () => {
      let text: string | null = null
      try {
        text = await this.deps.fs.readText(rel)
      } catch (e) {
        // 읽지 못한 기록 위에 새로 쓰면 이력을 잃는다. 없을 때만 새로 만든다.
        if (!(e instanceof FsGuardError && e.kind === 'missing')) throw e
      }
      if (text !== null && Buffer.byteLength(text, 'utf8') > ROTATE_BYTES) {
        const stamp = entry.at.toISOString().slice(0, 10).replace(/-/g, '')
        let n = 0
        for (;;) {
          try {
            await this.deps.fs.writeText(`${AUDIT_DIR}/${projectId}.${stamp}-${n}.md`, text, false)
            break
          } catch (e) {
            if (e instanceof FsGuardError && e.kind === 'exists' && n < 100) n++
            else throw e
          }
        }
        text = null
      }
      const head = `# 자동 실행 감사 기록: ${projectId}\n\n> 앱이 자동 모드 실행마다 한 줄 추가합니다. 직접 수정하지 마세요.\n\n${HEADER_ROW}\n|---|---|---|---|---|---|---|---|\n`
      const base = text !== null && text.trim() !== '' ? text.replace(/\n*$/, '\n') : head
      await this.deps.fs.writeText(rel, `${base}${line}\n`)
    })
  }

  private async rowsOf(projectId: string): Promise<AuditRow[]> {
    const rows: AuditRow[] = []
    const { files } = await this.deps.fs.listMarkdown(AUDIT_DIR)
    for (const f of files) {
      if (f !== `${projectId}.md` && !(f.startsWith(`${projectId}.`) && f.endsWith('.md'))) continue
      try {
        rows.push(...parseRows(await this.deps.fs.readText(`${AUDIT_DIR}/${f}`)))
      } catch {
        // 읽을 수 없는 파일은 건너뛴다 (요약은 읽기 전용이라 오류로 막지 않는다).
      }
    }
    return rows
  }

  /** 방문 요약(T-043)용. 기간 [from, to) 안의 프로젝트별 건수와 실패·차단 목록. */
  async summary(from: Date, to: Date): Promise<AuditSummary> {
    const { files } = await this.deps.fs.listMarkdown(AUDIT_DIR)
    const ids = new Set<string>()
    for (const f of files) {
      const id = f.slice(0, f.indexOf('.'))
      if (PROJECT_ID.test(id)) ids.add(id)
    }
    const projects: AuditProjectSummary[] = []
    for (const projectId of [...ids].sort()) {
      const counts = Object.fromEntries(
        LIMITED_ACTIONS.map((a) => [a, Object.fromEntries(AUDIT_RESULTS.map((r) => [r, 0]))])
      ) as AuditProjectSummary['counts']
      const failures: AuditFailure[] = []
      let any = false
      const rows = (await this.rowsOf(projectId)).filter(
        (r) => r.time >= from.getTime() && r.time < to.getTime()
      )
      for (const r of rows.sort((a, b) => b.time - a.time)) {
        any = true
        counts[r.action][r.result]++
        if (r.result !== 'executed' && r.result !== 'duplicate' && failures.length < MAX_FAILURES)
          failures.push({
            at: r.at,
            action: r.action,
            target: r.target,
            result: r.result,
            employee: r.employee,
            ticket: r.ticket
          })
      }
      if (any) projects.push({ projectId, counts, failures })
    }
    return { from: from.toISOString(), to: to.toISOString(), projects }
  }
}

interface AuditRow {
  at: string
  time: number
  action: LimitedAction
  target: string
  result: AuditResult
  employee: string
  ticket: string
}

function parseRows(text: string): AuditRow[] {
  const out: AuditRow[] = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('| ')) continue
    const cells = line.slice(2, line.endsWith(' |') ? -2 : undefined).split(' | ')
    if (cells.length !== 8) continue
    const [at, action, target, result, employee, ticket] = cells
    const time = Date.parse(at)
    if (
      Number.isNaN(time) ||
      !(LIMITED_ACTIONS as readonly string[]).includes(action) ||
      !(AUDIT_RESULTS as readonly string[]).includes(result)
    )
      continue
    out.push({
      at,
      time,
      action: action as LimitedAction,
      target,
      result: result as AuditResult,
      employee,
      ticket
    })
  }
  return out
}
