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
import { normalizeMemo } from './decision-memo'
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

  /** 이미 열린 회사의 SafeFs로 만든다. 핸들러는 경로를 받지 않고 이 경로로만 접근한다. */
  static fromSafeFs(fs: SafeFs): FileCompanyRepository {
    return new FileCompanyRepository(fs, basename(fs.root))
  }

  // 같은 프로세스의 도메인 쓰기(결정 resolve, 티켓 이동)를 한 줄로 세운다. 두 번 클릭/동시 호출이 같은 파일을
  // 겹쳐 쓰지 않게 하고, 뒤따르는 호출은 앞 호출이 끝난 뒤 다시 읽어 conflict(결정) 또는 멱등 ok(티켓)로 판정된다.
  private writeQueue: Promise<unknown> = Promise.resolve()

  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const run = this.writeQueue.then(task, task)
    this.writeQueue = run.catch(() => undefined)
    return run
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
    const { files, skipped } = await this.scan(AGENTS_DIR, issues)
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
      // 기존 파일을 읽을 수 없거나 깨져 있으면 덮어쓰지 않고 실패시킨다 (본문 유실 방지).
      let existing: { data: Record<string, unknown>; body: string } | null = null
      try {
        existing = splitFrontmatter(await this.fs.readText(path))
      } catch (e) {
        if (!(e instanceof FsGuardError && e.kind === 'missing')) return toFailure(e)
      }
      // 앱이 모르는 frontmatter 키(다른 도구가 넣은 값)는 보존하고 넘겨받은 필드만 갱신한다.
      const data: Record<string, unknown> = { ...existing?.data }
      data.name = input.name
      data.description = input.description
      if (input.tools) data.tools = input.tools
      if (input.model) data.model = input.model
      const body = input.body ?? existing?.body ?? `# ${input.name}`
      const text = `---\n${stringifyYaml(data, { lineWidth: 0 })}---\n\n${body.trim()}\n`
      await this.fs.writeText(path, text)
    } catch (e) {
      return toFailure(e)
    }
    return this.getEmployee(input.id)
  }

  // ---- 티켓 ----

  async listTickets(status?: TicketStatus): Promise<Listing<Ticket>> {
    const issues: LoadIssue[] = []
    const found: Array<{ item: Ticket; path: string }> = []
    // 중복 판정을 위해 필터와 무관하게 모든 폴더를 읽고, 마지막에 상태로 거른다.
    for (const st of TICKET_STATUSES) {
      const dir = TICKET_DIRS[st]
      const { files, skipped } = await this.scan(dir, issues)
      for (const s of skipped)
        issues.push({
          path: relPath(dir, s),
          message: '일반 파일이 아니어서 건너뜀',
          reason: 'unreadable'
        })
      for (const f of files) {
        const path = relPath(dir, f)
        try {
          found.push({ item: parseTicket(f, await this.fs.readText(path), st), path })
        } catch (e) {
          issues.push({ path, message: issueMessage(e), reason: reasonOf(e) })
        }
      }
    }
    // 이동 도중 앱이 종료되면 같은 티켓이 두 폴더에 남을 수 있다. 어느 쪽이 새 것인지 알 수 없으므로
    // 호출마다 같은 결과가 나오도록 더 진행된 상태(done > in-progress > backlog)를 보이고 나머지는 숨긴다.
    const rank = (t: Ticket): number => TICKET_STATUSES.length - TICKET_STATUSES.indexOf(t.status)
    const ordered = [...found].sort(
      (a, b) =>
        numOf(a.item.id) - numOf(b.item.id) ||
        rank(a.item) - rank(b.item) ||
        (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
    )
    const items: Ticket[] = []
    let lastId = ''
    for (const { item, path } of ordered) {
      if (item.id === lastId) {
        issues.push({ path, message: '같은 id의 티켓이 이미 있어 숨김', reason: 'duplicate' })
        continue
      }
      lastId = item.id
      if (!status || item.status === status) items.push(item)
    }
    return { items, issues }
  }

  async getTicket(id: string): Promise<ApiResult<Ticket>> {
    if (typeof id !== 'string' || !TICKET_ID.test(id))
      return fail('invalid-request', '잘못된 티켓 id입니다.')
    const found = (await this.listTickets()).items.find((t) => t.id === id)
    return found ? { ok: true, value: found } : fail('not-found', '티켓을 찾을 수 없습니다.')
  }

  moveTicket(id: string, status: TicketStatus): Promise<ApiResult<Ticket>> {
    return this.serialize(() => this.moveTicketNow(id, status))
  }

  private async moveTicketNow(id: string, status: TicketStatus): Promise<ApiResult<Ticket>> {
    if (typeof id !== 'string' || !TICKET_ID.test(id))
      return fail('invalid-request', '잘못된 티켓 id입니다.')
    if (!TICKET_STATUSES.includes(status)) return fail('invalid-request', '잘못된 티켓 상태입니다.')
    try {
      // 목록(listTickets)과 같은 규칙으로 화면에 보이는 사본(done > in-progress > backlog)을 대상으로 삼는다.
      const copies = await this.findAllFiles(
        [...TICKET_STATUSES].reverse().map((s) => TICKET_DIRS[s]),
        (n) => n.startsWith(`${id}-`) || n === `${id}.md`
      )
      const file = copies[0]
      if (!file) return fail('not-found', '티켓을 찾을 수 없습니다.')
      const target = relPath(TICKET_DIRS[status], file.name)
      // 같은 티켓의 낮은 순위 사본은 이동 도중 끊긴 흔적이다. 내용이 같을 때만 정리하고, 다르면 사람이 정하게
      // conflict로 둔다 (보이는 사본과 움직이는 사본이 어긋나 ok인데 화면이 그대로인 일을 막는다).
      if (copies.length > 1) {
        const visible = withTicketStatus(await this.fs.readText(file.path), status)
        for (const other of copies.slice(1))
          if (withTicketStatus(await this.fs.readText(other.path), status) !== visible)
            return fail('conflict', '같은 번호의 다른 티켓 파일이 이미 있습니다.')
        for (const other of copies.slice(1)) await this.fs.remove(other.path)
      }
      // 이미 그 상태면 더 쓰지 않는다 (두 번 클릭, 동시 호출은 멱등 ok).
      if (file.path === target) return this.getTicket(id)
      const original = await this.fs.readText(file.path)
      // 목록에서 빠지는 손상 티켓은 옮기지 않는다 (옮긴 뒤 읽을 수 없게 되는 일을 막는다).
      const text = withTicketStatus(original, status)
      // 쓰기 전에 결과를 다시 파싱해 같은 티켓으로 읽히는지 확인한다. 파서 오류(YAML 오류 포함)는 모두 입력 문제로 본다.
      try {
        const before = parseTicket(file.name, original, currentStatus(file.path))
        const check = parseTicket(file.name, text, status)
        if (check.id !== before.id || check.title !== before.title) throw new Error('mismatch')
      } catch {
        return fail('invalid-request', '읽을 수 없는 티켓은 이동할 수 없습니다.')
      }
      // 새 위치에 먼저 쓰고 성공한 뒤 옛 파일을 지운다 (중간 실패 시 티켓이 사라지지 않는다).
      await this.relocate(file.path, target, text, original)
    } catch (e) {
      return toFailure(e)
    }
    return this.getTicket(id)
  }

  // ---- 결정 ----

  async listDecisions(status?: Decision['status']): Promise<Listing<Decision>> {
    const issues: LoadIssue[] = []
    const found: Array<{ item: Decision; path: string }> = []
    // 중복 판정을 위해 필터와 무관하게 양쪽 폴더를 모두 읽고, 마지막에 상태로 거른다.
    for (const st of DECISION_STATUSES) {
      const dir = DECISION_DIRS[st]
      const { files, skipped } = await this.scan(dir, issues)
      for (const s of skipped)
        issues.push({
          path: relPath(dir, s),
          message: '일반 파일이 아니어서 건너뜀',
          reason: 'unreadable'
        })
      for (const f of files) {
        const path = relPath(dir, f)
        try {
          found.push({ item: parseDecision(f, await this.fs.readText(path), st), path })
        } catch (e) {
          issues.push({ path, message: issueMessage(e), reason: reasonOf(e) })
        }
      }
    }
    // 앱이 resolve 도중 종료되면 같은 카드가 양쪽에 남을 수 있다. 결정이 기록된 done을 우선하고 나머지는 숨긴다.
    const rank = (d: Decision): number => (d.status === 'done' ? 0 : 1)
    const ordered = [...found].sort(
      (a, b) =>
        numOf(a.item.id) - numOf(b.item.id) ||
        rank(a.item) - rank(b.item) ||
        // 같은 폴더의 같은 id는 파일명순으로 고정해 어느 쪽이 보일지 호출마다 바뀌지 않게 한다.
        (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
    )
    const items: Decision[] = []
    let lastId = ''
    for (const { item, path } of ordered) {
      if (item.id === lastId) {
        issues.push({ path, message: '같은 id의 카드가 이미 있어 숨김', reason: 'duplicate' })
        continue
      }
      lastId = item.id
      if (!status || item.status === status) items.push(item)
    }
    return { items, issues }
  }

  async getDecision(id: string): Promise<ApiResult<Decision>> {
    if (typeof id !== 'string' || !DECISION_ID.test(id))
      return fail('invalid-request', '잘못된 결정 id입니다.')
    const found = (await this.listDecisions()).items.find((d) => d.id === id)
    return found ? { ok: true, value: found } : fail('not-found', '결정 카드를 찾을 수 없습니다.')
  }

  resolveDecision(req: DecisionResolveRequest): Promise<ApiResult<Decision>> {
    return this.serialize(() => this.resolveDecisionNow(req))
  }

  private async resolveDecisionNow(req: DecisionResolveRequest): Promise<ApiResult<Decision>> {
    if (typeof req !== 'object' || req === null)
      return fail('invalid-request', '잘못된 요청입니다.')
    const { id, choice, memo } = req
    if (typeof id !== 'string' || !DECISION_ID.test(id))
      return fail('invalid-request', '잘못된 결정 id입니다.')
    if (typeof choice !== 'string') return fail('invalid-request', '잘못된 선택입니다.')
    if (typeof memo !== 'undefined' && (typeof memo !== 'string' || memo.length > MAX_MEMO_LENGTH))
      return fail('invalid-request', `메모는 ${MAX_MEMO_LENGTH}자 이하여야 합니다.`)
    // 줄바꿈 변형을 통일하고 제어문자는 거부한다. 단독 CR, NEL 등으로 카드 줄 구조를 위조하지 못하게 한다.
    const cleanMemo = normalizeMemo(memo ?? '')
    if (cleanMemo === null) return fail('invalid-request', '메모에 쓸 수 없는 문자가 있습니다.')
    const matchId = (n: string): boolean => n.startsWith(`${id}-`) || n === `${id}.md`
    try {
      const done = await this.findFile([DECISION_DIRS.done], matchId)
      const pending = await this.findFile([DECISION_DIRS.pending], matchId)
      if (done) {
        // 이전 resolve가 done 쓰기 후 pending 삭제 전에 끊긴 상태다. done에 결정이 기록되어 있으면 남은 pending을
        // 정리해 영구 충돌을 풀되, 새 선택은 적용하지 않는다 (먼저 기록된 결정이 우선).
        if (pending && pending.name === done.name) {
          const recorded = parseDecision(done.name, await this.fs.readText(done.path), 'done')
          if (recorded.chosen !== null) await this.fs.remove(pending.path).catch(() => undefined)
        }
        return fail('conflict', '이미 처리된 결정입니다.')
      }
      if (!pending) return fail('not-found', '결정 카드를 찾을 수 없습니다.')
      const text = await this.fs.readText(pending.path)
      const card = parseDecision(pending.name, text, 'pending')
      if (!card.options.some((o) => o.key === choice))
        return fail('invalid-request', '카드에 없는 선택지입니다.')
      const target = relPath(DECISION_DIRS.done, pending.name)
      const next = withDecisionResolved(text, choice, cleanMemo)
      // 닫히지 않은 코드 펜스 등으로 `## 결정`을 못 찾는 카드는 쓴 결과가 읽히지 않는다. 쓰기 전에 다시 파싱해 확인한다.
      const check = parseDecision(pending.name, next, 'done')
      if (check.chosen !== choice || check.memo !== roundTripMemo(cleanMemo))
        return fail('invalid-request', '카드 형식 때문에 결정을 기록할 수 없습니다.')
      await this.relocate(pending.path, target, next, text)
    } catch (e) {
      return toFailure(e)
    }
    return this.getDecision(id)
  }

  // ---- 보고서 ----

  async listReports(): Promise<Listing<Report>> {
    const issues: LoadIssue[] = []
    const items: Report[] = []
    const { files, skipped } = await this.scan(REPORTS_DIR, issues)
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

  /** 디렉터리 단위 오류(링크 디렉터리, 권한 등)는 예외 대신 오류 항목으로 바꾼다. */
  private async scan(
    dir: string,
    issues: LoadIssue[]
  ): Promise<{ files: string[]; skipped: string[] }> {
    try {
      return await this.fs.listMarkdown(dir)
    } catch (e) {
      issues.push({ path: dir, message: issueMessage(e), reason: reasonOf(e) })
      return { files: [], skipped: [] }
    }
  }

  /**
   * 새 위치에 먼저 쓰고 옛 파일을 지운다. 이전 시도가 중간에 끊겨 같은 내용의 새 파일이 이미 있으면
   * 옛 파일만 지워 복구하고, 내용이 다르면 conflict로 둔다. 옛 파일 삭제가 실패하면 새 파일을 되돌린다.
   * `original`은 읽었던 옛 파일 내용이다. 지우기 직전에 다시 읽어 달라졌으면(외부 수정) 지우지 않고 새 파일을 되돌린 뒤
   * conflict로 처리한다. 그대로 지우면 읽은 뒤에 쓰인 내용이 사라진다.
   */
  private async relocate(from: string, to: string, text: string, original: string): Promise<void> {
    let created = true
    try {
      await this.fs.writeText(to, text, false)
    } catch (e) {
      if (!(e instanceof FsGuardError && e.kind === 'exists')) throw e
      if ((await this.fs.readText(to)) !== text) throw e
      created = false
    }
    const undo = async (): Promise<void> => {
      if (created) await this.fs.remove(to).catch(() => undefined)
    }
    try {
      let current: string | null
      try {
        current = await this.fs.readText(from)
      } catch (e) {
        if (!(e instanceof FsGuardError && e.kind === 'missing')) throw e
        current = null
      }
      // 원본이 이미 없거나 바뀌었다면 다른 프로세스(CLI 에이전트 등)가 먼저 건드린 것이다.
      if (current !== original) throw new FsGuardError('exists', '이미 처리되었습니다.')
      await this.fs.remove(from)
    } catch (e) {
      await undo()
      if ((e as NodeJS.ErrnoException).code === 'ENOENT')
        throw new FsGuardError('exists', '이미 처리되었습니다.')
      throw e
    }
  }

  /** 이름 조건에 맞는 일반 파일을 모든 폴더에서 찾아 폴더 순서대로 돌려준다. */
  private async findAllFiles(
    dirs: string[],
    match: (name: string) => boolean
  ): Promise<Array<{ path: string; name: string }>> {
    const found: Array<{ path: string; name: string }> = []
    for (const dir of dirs) {
      const { files } = await this.scan(dir, [])
      for (const name of files.filter(match)) found.push({ path: relPath(dir, name), name })
    }
    return found
  }

  /** 여러 폴더에서 이름 조건에 맞는 첫 일반 파일을 찾는다. 경로는 항상 디렉터리 목록에서 나온 것만 쓴다. */
  private async findFile(
    dirs: string[],
    match: (name: string) => boolean
  ): Promise<{ path: string; name: string } | null> {
    for (const dir of dirs) {
      const { files } = await this.scan(dir, [])
      const name = files.find(match)
      if (name) return { path: relPath(dir, name), name }
    }
    return null
  }
}

/** 쓸 때 줄 단위로 trim되므로 읽어서 돌아오는 메모는 각 줄의 앞뒤 공백이 없는 형태다. */
function roundTripMemo(memo: string): string {
  return memo
    .trim()
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
}

function reasonOf(e: unknown): 'unreadable' | 'too-large' {
  return e instanceof FsGuardError && e.kind === 'too-large' ? 'too-large' : 'unreadable'
}

function currentStatus(path: string): TicketStatus {
  return TICKET_STATUSES.find((s) => path.startsWith(`${TICKET_DIRS[s]}/`)) ?? 'backlog'
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
