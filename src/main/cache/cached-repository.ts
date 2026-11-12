import type { CompanyInfo } from '../../shared/company'
import type { Decision, DecisionResolveRequest } from '../../shared/decision'
import type { Employee, OrgChart } from '../../shared/employee'
import type { Report } from '../../shared/report'
import type { ApiResult } from '../../shared/result'
import type { Ticket, TicketStatus } from '../../shared/ticket'
import { DECISION_ID, EMPLOYEE_ID, REPORT_ID, TICKET_ID } from '../repository/ids'
import { DECISION_DIRS } from '../repository/parse-decision'
import { TICKET_DIRS } from '../repository/parse-ticket'
import type { CompanyRepository, EmployeeInput, Listing, LoadIssue } from '../repository/repository'
import { CacheCorruptError, isCorruption, type CacheStore, type EntryKind } from './cache-store'

export type RefreshKind = EntryKind

const ALL_KINDS: readonly RefreshKind[] = ['org', 'ticket', 'decision', 'report']

function fail<T>(code: 'invalid-request' | 'not-found', message: string): ApiResult<T> {
  return { ok: false, code, message }
}

function scopeOf(path: string, dirs: Record<string, string>): string {
  for (const [status, dir] of Object.entries(dirs)) if (path.startsWith(`${dir}/`)) return status
  return ''
}

function hasId(v: unknown): v is { id: string } {
  return typeof v === 'object' && v !== null && typeof (v as { id?: unknown }).id === 'string'
}

function asItems<T extends { id: string }>(rows: unknown[]): T[] {
  // 캐시 파일은 앱 데이터 영역에 있지만 변조/손상될 수 있으니 최소 형태를 확인한다.
  for (const r of rows) if (!hasId(r)) throw new CacheCorruptError('row shape is invalid')
  return rows as T[]
}

function asOrg(v: unknown): OrgChart {
  const o = v as { employees?: unknown; departments?: unknown } | null
  if (!o || !Array.isArray(o.employees) || !Array.isArray(o.departments))
    throw new CacheCorruptError('org shape is invalid')
  return v as OrgChart
}

/**
 * 읽기는 SQLite 캐시, 쓰기는 파일 기반 Repository에 위임한 뒤 영향받은 종류만 캐시를 갱신한다.
 * 원본은 항상 마크다운이다. 캐시가 비어 있거나 손상되면 폴더에서 다시 채운다.
 */
export class CachedCompanyRepository implements CompanyRepository {
  /** 갱신을 직렬화해 오래된 스캔 결과가 새 결과를 덮어쓰지 않게 한다. */
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly source: CompanyRepository,
    private readonly store: CacheStore
  ) {}

  /** 캐시를 비우고 폴더에서 처음부터 다시 만든다. */
  async rebuild(): Promise<void> {
    await this.enqueue(async () => {
      this.store.reset()
      await this.refreshNow(ALL_KINDS)
    })
  }

  /** 변경된 종류만 다시 읽는다 (감시자와 쓰기 메서드가 호출). */
  refresh(kinds: Iterable<RefreshKind>): Promise<void> {
    const list = [...new Set(kinds)]
    return this.enqueue(() => this.refreshNow(list))
  }

  private enqueue(job: () => Promise<void>): Promise<void> {
    const run = this.queue.then(job)
    this.queue = run.catch(() => undefined)
    return run
  }

  private async refreshNow(kinds: readonly RefreshKind[]): Promise<void> {
    for (const kind of kinds) {
      switch (kind) {
        case 'org': {
          const { org, issues } = await this.source.listEmployees()
          this.store.replaceKind('org', [{ id: 'org', data: org }], issues)
          break
        }
        case 'ticket': {
          const { items, issues } = await this.source.listTickets()
          this.store.replaceKind(
            'ticket',
            items.map((t) => ({ id: t.id, status: t.status, title: t.title, data: t })),
            issues.map((i) => ({ ...i, scope: scopeOf(i.path, TICKET_DIRS) }))
          )
          break
        }
        case 'decision': {
          const { items, issues } = await this.source.listDecisions()
          this.store.replaceKind(
            'decision',
            items.map((d) => ({ id: d.id, status: d.status, title: d.title, data: d })),
            issues.map((i) => ({ ...i, scope: scopeOf(i.path, DECISION_DIRS) }))
          )
          break
        }
        case 'report': {
          const { items, issues } = await this.source.listReports()
          this.store.replaceKind(
            'report',
            items.map((r) => ({ id: r.id, title: r.title, data: r })),
            issues
          )
          break
        }
      }
    }
  }

  /** 읽기 공통 경로: 비어 있으면 채우고, 손상이면 재생성 후 한 번 재시도한다. */
  private async read<T>(kind: EntryKind, fn: () => T): Promise<T> {
    try {
      if (!this.store.isPopulated(kind)) await this.refresh([kind])
      return fn()
    } catch (e) {
      if (!isCorruption(e)) throw e
      await this.rebuild()
      return fn()
    }
  }

  // ---- 읽기: 캐시 ----

  getCompany(): Promise<ApiResult<CompanyInfo>> {
    // 미션 본문 하나라 캐시 이득이 없고 항상 최신이어야 해서 원본을 읽는다.
    return this.source.getCompany()
  }

  async listEmployees(): Promise<{ org: OrgChart; issues: LoadIssue[] }> {
    return this.read('org', () => {
      const org = asOrg(this.store.get('org', 'org'))
      return { org, issues: this.store.issues('org') }
    })
  }

  async getEmployee(id: string): Promise<ApiResult<Employee>> {
    if (typeof id !== 'string' || !EMPLOYEE_ID.test(id))
      return fail('invalid-request', '잘못된 직원 id입니다.')
    const { org } = await this.listEmployees()
    const found = org.employees.find((e) => e.id === id)
    return found ? { ok: true, value: found } : fail('not-found', '직원을 찾을 수 없습니다.')
  }

  listTickets(status?: TicketStatus): Promise<Listing<Ticket>> {
    return this.read('ticket', () => {
      // 알 수 없는 상태 값은 원본 Repository처럼 빈 결과.
      if (status !== undefined && !(status in TICKET_DIRS)) return { items: [], issues: [] }
      return {
        items: asItems<Ticket>(this.store.list('ticket', status)),
        issues: this.store.issues('ticket', status)
      }
    })
  }

  async getTicket(id: string): Promise<ApiResult<Ticket>> {
    if (typeof id !== 'string' || !TICKET_ID.test(id))
      return fail('invalid-request', '잘못된 티켓 id입니다.')
    const found = await this.read('ticket', () => this.store.get('ticket', id))
    if (found === undefined) return fail('not-found', '티켓을 찾을 수 없습니다.')
    return { ok: true, value: asItems<Ticket>([found])[0] }
  }

  listDecisions(status?: Decision['status']): Promise<Listing<Decision>> {
    return this.read('decision', () => {
      if (status !== undefined && !(status in DECISION_DIRS)) return { items: [], issues: [] }
      return {
        items: asItems<Decision>(this.store.list('decision', status)),
        issues: this.store.issues('decision', status)
      }
    })
  }

  async getDecision(id: string): Promise<ApiResult<Decision>> {
    if (typeof id !== 'string' || !DECISION_ID.test(id))
      return fail('invalid-request', '잘못된 결정 id입니다.')
    const found = await this.read('decision', () => this.store.get('decision', id))
    if (found === undefined) return fail('not-found', '결정 카드를 찾을 수 없습니다.')
    return { ok: true, value: asItems<Decision>([found])[0] }
  }

  listReports(): Promise<Listing<Report>> {
    return this.read('report', () => ({
      items: asItems<Report>(this.store.list('report')),
      issues: this.store.issues('report')
    }))
  }

  async getReport(id: string): Promise<ApiResult<Report>> {
    if (typeof id !== 'string' || !REPORT_ID.test(id))
      return fail('invalid-request', '잘못된 보고서 id입니다.')
    const found = await this.read('report', () => this.store.get('report', id))
    if (found === undefined) return fail('not-found', '보고서를 찾을 수 없습니다.')
    return { ok: true, value: asItems<Report>([found])[0] }
  }

  // ---- 쓰기: 파일 Repository에 위임 후 캐시 갱신 ----

  async saveEmployee(input: EmployeeInput): Promise<ApiResult<Employee>> {
    const res = await this.source.saveEmployee(input)
    // 실패해도 부분 변경 가능성이 있어 항상 갱신한다.
    await this.refresh(['org'])
    return res
  }

  async moveTicket(id: string, status: TicketStatus): Promise<ApiResult<Ticket>> {
    const res = await this.source.moveTicket(id, status)
    await this.refresh(['ticket'])
    return res
  }

  async resolveDecision(req: DecisionResolveRequest): Promise<ApiResult<Decision>> {
    const res = await this.source.resolveDecision(req)
    await this.refresh(['decision'])
    return res
  }

  async createReport(id: string, markdown: string): Promise<ApiResult<Report>> {
    const res = await this.source.createReport(id, markdown)
    await this.refresh(['report'])
    return res
  }
}
