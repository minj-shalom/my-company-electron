import { basename } from 'node:path'
import { stringify as stringifyYaml } from 'yaml'
import type { CompanyInfo } from '../../shared/company'
import type { Decision, DecisionResolveRequest } from '../../shared/decision'
import type { Employee, OrgChart } from '../../shared/employee'
import type { Report } from '../../shared/report'
import type { ApiResult, DomainErrorCode } from '../../shared/result'
import type { Ticket, TicketStatus } from '../../shared/ticket'
import {
  DECISION_ID,
  EMPLOYEE_ID,
  MAX_MARKDOWN_LENGTH,
  MAX_MEMO_LENGTH,
  REPORT_ID,
  TICKET_ID
} from './ids'
import { splitFrontmatter } from './markdown'
import { DECISION_DIRS, parseDecision, withDecisionResolved } from './parse-decision'
import { AGENTS_DIR, ORG_FILE, buildOrg, parseAgentFile, parseOrgRows } from './parse-org'
import { parseReport } from './parse-report'
import { TICKET_DIRS, parseTicket, withTicketStatus } from './parse-ticket'
import type { CompanyRepository, EmployeeInput, Listing, LoadIssue } from './repository'
import { FsGuardError, SafeFs, relPath } from './safe-fs'

const REPORTS_DIR = 'company/reports'
const MISSION_FILE = 'company/mission.md'
const TICKET_STATUSES = Object.keys(TICKET_DIRS) as TicketStatus[]
const DECISION_STATUSES = Object.keys(DECISION_DIRS) as Array<Decision['status']>

function fail<T>(code: DomainErrorCode, message: string): ApiResult<T> {
  return { ok: false, code, message }
}

/** 예상 밖 예외를 경로 노출 없이 ApiResult로 바꾼다. */
function toFailure<T>(e: unknown): ApiResult<T> {
  if (e instanceof FsGuardError) {
    if (e.kind === 'exists') return fail('conflict', '이미 존재합니다.')
    if (e.kind === 'missing') return fail('not-found', '대상을 찾을 수 없습니다.')
    return fail('invalid-request', '허용되지 않는 경로 또는 파일입니다.')
  }
  return fail('internal', '파일을 처리하지 못했습니다.')
}

/** 사용자에게 보일 오류 사유. 내부 경로가 섞인 시스템 오류 메시지는 쓰지 않는다. */
function issueMessage(e: unknown): string {
  if (e instanceof FsGuardError) return e.message
  if (e instanceof Error && !('code' in e) && !('path' in e)) return e.message.slice(0, 200)
  return '파일을 읽지 못했습니다.'
}

/** 회사 폴더의 마크다운을 원본으로 하는 Repository 구현. */
export class FileCompanyRepository implements CompanyRepository {
  private constructor(
    private readonly fs: SafeFs,
    private readonly companyName: string
  ) {}

  /** 회사 폴더 절대 경로로 연다. 폴더가 없으면 예외 (열기 전 단계에서 처리). */
  static async open(companyDir: string): Promise<FileCompanyRepository> {
    const fs = await SafeFs.open(companyDir)
    return new FileCompanyRepository(fs, basename(fs.root))
  }

  async getCompany(): Promise<ApiResult<CompanyInfo>> {
    let mission = ''
    try {
      mission = await this.fs.readText(MISSION_FILE)
    } catch (e) {
      if (!(e instanceof FsGuardError && e.kind === 'missing')) return toFailure(e)
    }
    return { ok: true, value: { name: this.companyName, dir: this.fs.root, mission } }
  }

  // ---- 직원 ----

  async listEmployees(): Promise<{ org: OrgChart; issues: LoadIssue[] }> {
    const issues: LoadIssue[] = []
    const agents: Array<Pick<Employee, 'id' | 'name' | 'description' | 'model'>> = []
    const { files, skipped } = await this.fs.listMarkdown(AGENTS_DIR)
    for (const s of skipped)
      issues.push({ path: relPath(AGENTS_DIR, s), message: '일반 파일이 아니어서 건너뜀' })
    for (const f of files) {
      const path = relPath(AGENTS_DIR, f)
      try {
        agents.push(parseAgentFile(f.replace(/\.md$/, ''), await this.fs.readText(path)))
      } catch (e) {
        issues.push({ path, message: issueMessage(e) })
      }
    }
    let rows: ReturnType<typeof parseOrgRows> = []
    try {
      rows = parseOrgRows(await this.fs.readText(ORG_FILE))
    } catch (e) {
      if (!(e instanceof FsGuardError && e.kind === 'missing'))
        issues.push({ path: ORG_FILE, message: issueMessage(e) })
    }
    const { org, orphanRows } = buildOrg(agents, rows)
    for (const r of orphanRows)
      issues.push({ path: ORG_FILE, message: `직원 파일이 없는 항목: ${r.employeeId}` })
    return { org, issues }
  }

  async getEmployee(id: string): Promise<ApiResult<Employee>> {
    if (typeof id !== 'string' || !EMPLOYEE_ID.test(id))
      return fail('invalid-request', '잘못된 직원 id입니다.')
    const { org } = await this.listEmployees()
    const found = org.employees.find((e) => e.id === id)
    return found ? { ok: true, value: found } : fail('not-found', '직원을 찾을 수 없습니다.')
  }

  async saveEmployee(input: EmployeeInput): Promise<ApiResult<Employee>> {
    const bad = validateEmployeeInput(input)
    if (bad) return fail('invalid-request', bad)
    const path = relPath(AGENTS_DIR, `${input.id}.md`)
    try {
      let body = input.body
      if (body === undefined) {
        try {
          body = splitFrontmatter(await this.fs.readText(path)).body
        } catch (e) {
          if (!(e instanceof FsGuardError && e.kind === 'missing')) body = ''
        }
      }
      const data: Record<string, string> = { name: input.name, description: input.description }
      if (input.tools) data.tools = input.tools
      if (input.model) data.model = input.model
      const text = `---\n${stringifyYaml(data, { lineWidth: 0 })}---\n\n${(body ?? `# ${input.name}`).trim()}\n`
      await this.fs.writeText(path, text)
    } catch (e) {
      return toFailure(e)
    }
    return this.getEmployee(input.id)
  }

  // ---- 티켓 ----

  async listTickets(status?: TicketStatus): Promise<Listing<Ticket>> {
    const issues: LoadIssue[] = []
    const items: Ticket[] = []
    for (const st of status ? [status] : TICKET_STATUSES) {
      if (!TICKET_STATUSES.includes(st)) continue
      const dir = TICKET_DIRS[st]
      const { files, skipped } = await this.fs.listMarkdown(dir)
      for (const s of skipped)
        issues.push({ path: relPath(dir, s), message: '일반 파일이 아니어서 건너뜀' })
      for (const f of files) {
        const path = relPath(dir, f)
        try {
          items.push(parseTicket(f, await this.fs.readText(path), st))
        } catch (e) {
          issues.push({ path, message: issueMessage(e) })
        }
      }
    }
    items.sort((a, b) => numOf(a.id) - numOf(b.id))
    return { items, issues }
  }

  async getTicket(id: string): Promise<ApiResult<Ticket>> {
    if (typeof id !== 'string' || !TICKET_ID.test(id))
      return fail('invalid-request', '잘못된 티켓 id입니다.')
    const found = (await this.listTickets()).items.find((t) => t.id === id)
    return found ? { ok: true, value: found } : fail('not-found', '티켓을 찾을 수 없습니다.')
  }

  async moveTicket(id: string, status: TicketStatus): Promise<ApiResult<Ticket>> {
    if (typeof id !== 'string' || !TICKET_ID.test(id))
      return fail('invalid-request', '잘못된 티켓 id입니다.')
    if (!TICKET_STATUSES.includes(status)) return fail('invalid-request', '잘못된 티켓 상태입니다.')
    try {
      const file = await this.findFile(
        TICKET_STATUSES.map((s) => TICKET_DIRS[s]),
        (n) => n.startsWith(`${id}-`) || n === `${id}.md`
      )
      if (!file) return fail('not-found', '티켓을 찾을 수 없습니다.')
      const target = relPath(TICKET_DIRS[status], file.name)
      if (file.path === target) return this.getTicket(id)
      const text = withTicketStatus(await this.fs.readText(file.path), status)
      // 새 위치에 먼저 쓰고 성공한 뒤 옛 파일을 지운다 (중간 실패 시 티켓이 사라지지 않는다).
      await this.fs.writeText(target, text, false)
      await this.fs.remove(file.path)
    } catch (e) {
      return toFailure(e)
    }
    return this.getTicket(id)
  }

  // ---- 결정 ----

  async listDecisions(status?: Decision['status']): Promise<Listing<Decision>> {
    const issues: LoadIssue[] = []
    const items: Decision[] = []
    for (const st of status ? [status] : DECISION_STATUSES) {
      if (!DECISION_STATUSES.includes(st)) continue
      const dir = DECISION_DIRS[st]
      const { files, skipped } = await this.fs.listMarkdown(dir)
      for (const s of skipped)
        issues.push({ path: relPath(dir, s), message: '일반 파일이 아니어서 건너뜀' })
      for (const f of files) {
        const path = relPath(dir, f)
        try {
          items.push(parseDecision(f, await this.fs.readText(path), st))
        } catch (e) {
          issues.push({ path, message: issueMessage(e) })
        }
      }
    }
    items.sort((a, b) => numOf(a.id) - numOf(b.id))
    return { items, issues }
  }

  async getDecision(id: string): Promise<ApiResult<Decision>> {
    if (typeof id !== 'string' || !DECISION_ID.test(id))
      return fail('invalid-request', '잘못된 결정 id입니다.')
    const found = (await this.listDecisions()).items.find((d) => d.id === id)
    return found ? { ok: true, value: found } : fail('not-found', '결정 카드를 찾을 수 없습니다.')
  }

  async resolveDecision(req: DecisionResolveRequest): Promise<ApiResult<Decision>> {
    if (typeof req !== 'object' || req === null)
      return fail('invalid-request', '잘못된 요청입니다.')
    const { id, choice, memo } = req
    if (typeof id !== 'string' || !DECISION_ID.test(id))
      return fail('invalid-request', '잘못된 결정 id입니다.')
    if (typeof choice !== 'string') return fail('invalid-request', '잘못된 선택입니다.')
    if (memo !== undefined && (typeof memo !== 'string' || memo.length > MAX_MEMO_LENGTH))
      return fail('invalid-request', `메모는 ${MAX_MEMO_LENGTH}자 이하여야 합니다.`)
    try {
      const file = await this.findFile(
        Object.values(DECISION_DIRS),
        (n) => n.startsWith(`${id}-`) || n === `${id}.md`
      )
      if (!file) return fail('not-found', '결정 카드를 찾을 수 없습니다.')
      if (!file.path.startsWith(DECISION_DIRS.pending))
        return fail('conflict', '이미 처리된 결정입니다.')
      const text = await this.fs.readText(file.path)
      const card = parseDecision(file.name, text, 'pending')
      if (!card.options.some((o) => o.key === choice))
        return fail('invalid-request', '카드에 없는 선택지입니다.')
      const target = relPath(DECISION_DIRS.done, file.name)
      await this.fs.writeText(target, withDecisionResolved(text, choice, memo ?? ''), false)
      await this.fs.remove(file.path)
    } catch (e) {
      return toFailure(e)
    }
    return this.getDecision(id)
  }

  // ---- 보고서 ----

  async listReports(): Promise<Listing<Report>> {
    const issues: LoadIssue[] = []
    const items: Report[] = []
    const { files, skipped } = await this.fs.listMarkdown(REPORTS_DIR)
    for (const s of skipped)
      issues.push({ path: relPath(REPORTS_DIR, s), message: '일반 파일이 아니어서 건너뜀' })
    for (const f of files) {
      const path = relPath(REPORTS_DIR, f)
      try {
        items.push(parseReport(f, await this.fs.readText(path)))
      } catch (e) {
        issues.push({ path, message: issueMessage(e) })
      }
    }
    return { items, issues }
  }

  async getReport(id: string): Promise<ApiResult<Report>> {
    if (typeof id !== 'string' || !REPORT_ID.test(id))
      return fail('invalid-request', '잘못된 보고서 id입니다.')
    const found = (await this.listReports()).items.find((r) => r.id === id)
    return found ? { ok: true, value: found } : fail('not-found', '보고서를 찾을 수 없습니다.')
  }

  async createReport(id: string, markdown: string): Promise<ApiResult<Report>> {
    if (typeof id !== 'string' || !REPORT_ID.test(id))
      return fail('invalid-request', '잘못된 보고서 id입니다.')
    if (
      typeof markdown !== 'string' ||
      markdown.length === 0 ||
      markdown.length > MAX_MARKDOWN_LENGTH
    )
      return fail('invalid-request', '보고서 내용 길이가 올바르지 않습니다.')
    try {
      parseReport(`${id}.md`, markdown)
      await this.fs.writeText(relPath(REPORTS_DIR, `${id}.md`), markdown, false)
    } catch (e) {
      if (e instanceof FsGuardError) return toFailure(e)
      return fail('invalid-request', issueMessage(e))
    }
    return this.getReport(id)
  }

  /** 여러 폴더에서 이름 조건에 맞는 첫 일반 파일을 찾는다. 경로는 항상 디렉터리 목록에서 나온 것만 쓴다. */
  private async findFile(
    dirs: string[],
    match: (name: string) => boolean
  ): Promise<{ path: string; name: string } | null> {
    for (const dir of dirs) {
      const { files } = await this.fs.listMarkdown(dir)
      const name = files.find(match)
      if (name) return { path: relPath(dir, name), name }
    }
    return null
  }
}

function numOf(id: string): number {
  return Number(id.slice(2))
}

function validateEmployeeInput(i: EmployeeInput): string | null {
  if (typeof i !== 'object' || i === null) return '잘못된 요청입니다.'
  if (typeof i.id !== 'string' || !EMPLOYEE_ID.test(i.id)) return '직원 id가 허용 형식이 아닙니다.'
  if (typeof i.name !== 'string' || i.name.trim().length === 0 || i.name.length > 100)
    return '이름은 1~100자여야 합니다.'
  if (
    typeof i.description !== 'string' ||
    i.description.trim().length === 0 ||
    i.description.length > 1000
  )
    return '설명은 1~1000자여야 합니다.'
  for (const k of ['tools', 'model'] as const) {
    const v = i[k]
    if (v !== undefined && (typeof v !== 'string' || v.length > 300))
      return `${k} 값이 올바르지 않습니다.`
  }
  if (i.body !== undefined && (typeof i.body !== 'string' || i.body.length > MAX_MARKDOWN_LENGTH))
    return '본문 길이가 올바르지 않습니다.'
  return null
}
