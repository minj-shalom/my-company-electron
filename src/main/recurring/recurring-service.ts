import type { ApiResult, DomainErrorCode } from '../../shared/result'
import { defaultTicketAssignee } from '../../shared/ticket'
import type { ProjectInfo } from '../../shared/project'
import {
  MAX_RECURRING_DEFS,
  MAX_RECURRING_PER_DAY,
  type RecurringDefinition,
  type RecurringList
} from '../../shared/recurring'
import { parsePolicyHours } from '../scheduler/active-window'
import type { PolicyHoursEntry } from '../scheduler/scheduler'
import { FsGuardError, MAX_FILE_BYTES, type SafeFs } from '../repository/safe-fs'
import type { TicketService } from '../ticket/ticket-service'
import { parseDefinition, parseIdRequest } from './recurring-input'
import {
  RECURRING_FILE,
  parseRecurring,
  serializeRecurring,
  type ParsedRecurring
} from './recurring-doc'
import {
  dayOf,
  matchesCadence,
  nextRunAt,
  renderTemplate,
  type DayClock
} from './recurring-schedule'

export interface RecurringServiceDeps {
  fs: SafeFs
  /** 정의 파일 쓰기 직렬화 큐 (FileCompanyRepository.runExclusive와 같은 큐). */
  exclusive: <T>(task: () => Promise<T>) => Promise<T>
  tickets: Pick<TicketService, 'scanRepeats' | 'createRecurring'>
  /** T-037 프로젝트 목록 (보관 포함, state 계산됨). 읽지 못하면 예외를 던진다. */
  projects: () => Promise<ProjectInfo[]>
  employeeIds: () => Promise<ReadonlySet<string>>
  /** 정책의 활동 요일·시간 (T-047). 읽지 못하면 예외를 던진다. */
  loadPolicyHours: () => Promise<PolicyHoursEntry[]>
  clock: DayClock
}

export interface MaterializeResult {
  /** 이번 실행의 기준 날짜 (YYYY-MM-DD). */
  date: string
  created: Array<{ definitionId: string; ticketId: string }>
  /** 만들지 못한 이유와 경고. 틱 브리핑의 막힌 점에 실린다. 경로·내부 오류 원문은 담지 않는다. */
  notes: string[]
}

const fail = (code: DomainErrorCode, message: string): ApiResult<never> => ({
  ok: false,
  code,
  message
})
const UNREADABLE_MSG =
  '읽을 수 없는 반복 업무 정의가 있어 앱에서 수정할 수 없습니다. 파일을 먼저 고쳐 주세요.'

export class RecurringService {
  constructor(private readonly deps: RecurringServiceDeps) {}

  private async load(): Promise<ParsedRecurring> {
    try {
      return parseRecurring(await this.deps.fs.readText(RECURRING_FILE))
    } catch (e) {
      if (e instanceof FsGuardError && e.kind === 'missing') return parseRecurring(null)
      throw e
    }
  }

  async list(): Promise<ApiResult<RecurringList>> {
    try {
      const doc = await this.load()
      const counts = await this.deps.tickets.scanRepeats()
      const now = this.deps.clock.now()
      const today = dayOf(now, this.deps.clock.timeZone).date
      return {
        ok: true,
        value: {
          items: doc.defs.slice(0, MAX_RECURRING_DEFS).map((d) => {
            const createdToday = (counts.get(`${d.id}/${today}`) ?? 0) >= d.count
            return {
              ...d,
              createdToday,
              nextRunAt:
                d.status === 'paused'
                  ? null
                  : nextRunAt(d.cadence, createdToday, now, this.deps.clock.timeZone)
            }
          }),
          unreadable: doc.unreadable,
          overLimit: Math.max(0, doc.defs.length - MAX_RECURRING_DEFS)
        }
      }
    } catch {
      return fail('internal', '반복 업무를 읽지 못했습니다.')
    }
  }

  add(raw: unknown): Promise<ApiResult<RecurringDefinition>> {
    const p = parseDefinition(raw)
    if (!p.ok) return Promise.resolve(fail('invalid-request', p.message))
    return this.mutate(p.value, (doc) => {
      if (doc.defs.some((d) => d.id === p.value.id))
        return fail('conflict', '같은 id의 반복 업무가 이미 있습니다.')
      if (doc.defs.length >= MAX_RECURRING_DEFS)
        return fail('invalid-request', `반복 업무는 ${MAX_RECURRING_DEFS}개까지 만들 수 있습니다.`)
      doc.defs.push(p.value)
      return p.value
    })
  }

  update(raw: unknown): Promise<ApiResult<RecurringDefinition>> {
    const p = parseDefinition(raw)
    if (!p.ok) return Promise.resolve(fail('invalid-request', p.message))
    return this.mutate(p.value, (doc) => {
      const at = doc.defs.findIndex((d) => d.id === p.value.id)
      if (at < 0) return fail('not-found', '반복 업무를 찾을 수 없습니다.')
      doc.defs[at] = p.value
      return p.value
    })
  }

  async setStatus(raw: unknown): Promise<ApiResult<RecurringDefinition>> {
    const p = parseIdRequest(raw, true)
    if (!p.ok) return fail('invalid-request', p.message)
    return this.mutate(null, (doc) => {
      const d = doc.defs.find((x) => x.id === p.value.id)
      if (d === undefined) return fail('not-found', '반복 업무를 찾을 수 없습니다.')
      d.status = p.value.status
      return d
    })
  }

  /** 정의만 지운다. 이미 만든 티켓은 그대로 둔다. */
  async remove(raw: unknown): Promise<ApiResult<{ id: string }>> {
    const p = parseIdRequest(raw, false)
    if (!p.ok) return fail('invalid-request', p.message)
    const r = await this.mutate(null, (doc) => {
      const at = doc.defs.findIndex((x) => x.id === p.value.id)
      if (at < 0) return fail('not-found', '반복 업무를 찾을 수 없습니다.')
      return doc.defs.splice(at, 1)[0]
    })
    return r.ok ? { ok: true, value: { id: p.value.id } } : r
  }

  /**
   * 읽기-수정-쓰기를 한 쓰기 큐 안에서 한다. `edit`이 오류 결과를 돌려주면 쓰지 않고, 정의를 돌려주면 저장한 뒤 그 정의를 결과로 쓴다.
   * `checkRefs`가 있으면(추가·수정) 프로젝트와 담당 직원이 현재 조직에 있는지 확인한다.
   */
  private mutate(
    checkRefs: RecurringDefinition | null,
    edit: (doc: ParsedRecurring) => ApiResult<never> | RecurringDefinition
  ): Promise<ApiResult<RecurringDefinition>> {
    return this.deps.exclusive(async () => {
      try {
        if (checkRefs !== null) {
          const project = (await this.deps.projects()).find((x) => x.id === checkRefs.projectId)
          if (project === undefined || project.status === 'archived')
            return fail('invalid-request', '선택할 수 없는 프로젝트입니다.')
          if (
            checkRefs.assignee !== null &&
            !(await this.deps.employeeIds()).has(checkRefs.assignee)
          )
            return fail('invalid-request', '조직에 없는 담당 직원입니다.')
        }
        const doc = await this.load()
        if (doc.unreadable > 0) return fail('conflict', UNREADABLE_MSG)
        const out = edit(doc)
        if ('ok' in out) return out
        const text = serializeRecurring(doc.preface, doc.defs)
        if (Buffer.byteLength(text, 'utf8') > MAX_FILE_BYTES)
          return fail('invalid-request', '반복 업무 파일이 너무 큽니다.')
        await this.deps.fs.writeText(RECURRING_FILE, text, true)
        return { ok: true, value: out }
      } catch {
        return fail('internal', '반복 업무를 저장하지 못했습니다.')
      }
    })
  }

  /**
   * 오늘 몫의 정기 티켓을 backlog에 만든다 (스케줄러 틱 시작 전). 소급하지 않는다: 오늘 날짜의 몫만 만들고,
   * `- **반복:** <id>/<날짜>` 줄 수로 이미 만든 만큼은 건너뛴다 (재시작·재실행에도 멱등).
   */
  async materialize(): Promise<MaterializeResult> {
    const now = this.deps.clock.now()
    const today = dayOf(now, this.deps.clock.timeZone)
    const result: MaterializeResult = { date: today.date, created: [], notes: [] }
    const doc = await this.load()
    if (doc.unreadable > 0)
      result.notes.push(`읽을 수 없는 반복 업무 정의 ${doc.unreadable}개를 건너뛰었어요.`)
    if (doc.defs.length > MAX_RECURRING_DEFS)
      result.notes.push(
        `반복 업무 정의가 ${MAX_RECURRING_DEFS}개를 넘어 ${doc.defs.length - MAX_RECURRING_DEFS}개를 처리하지 않았어요.`
      )
    const due = doc.defs
      .slice(0, MAX_RECURRING_DEFS)
      .filter((d) => d.status === 'active' && matchesCadence(d.cadence, today.weekday))
    if (due.length === 0) return result

    let projects: ProjectInfo[]
    let hours: PolicyHoursEntry[]
    let employees: ReadonlySet<string>
    let counts: Map<string, number>
    try {
      ;[projects, hours, employees, counts] = await Promise.all([
        this.deps.projects(),
        this.deps.loadPolicyHours(),
        this.deps.employeeIds(),
        this.deps.tickets.scanRepeats()
      ])
    } catch {
      result.notes.push('프로젝트·정책·티켓을 읽지 못해 정기 티켓을 만들지 못했어요.')
      return result
    }
    let todayTotal = [...counts].reduce(
      (n, [k, v]) => (k.endsWith(`/${today.date}`) ? n + v : n),
      0
    )

    for (const def of due) {
      const project = projects.find((p) => p.id === def.projectId)
      if (project === undefined) {
        result.notes.push(`${def.id}: 프로젝트 ${def.projectId}를 찾을 수 없어 만들지 않았어요.`)
        continue
      }
      if (project.status === 'archived') continue
      if (project.state === 'pm-required') {
        result.notes.push(
          `${def.id}: ${project.name} 프로젝트에 담당 PM이 필요해 정기 티켓을 만들지 않았어요.`
        )
        continue
      }
      const entry = hours.find((h) => h.projectId === project.id)
      if (entry?.unreadable) {
        result.notes.push(`${def.id}: 프로젝트 정책을 읽지 못해 만들지 않았어요.`)
        continue
      }
      if (entry?.hours != null) {
        const w = parsePolicyHours(entry.hours)
        if (w === null) {
          result.notes.push(`${def.id}: 정책의 활동 요일·시간을 해석하지 못해 만들지 않았어요.`)
          continue
        }
        // 요일만 본다. 시간대는 틱 실행이 지킨다.
        if (!w.days.has(today.weekday)) continue
      }

      let assignee: string | null
      if (def.assignee === null) assignee = defaultTicketAssignee(project)
      else if (
        employees.has(def.assignee) &&
        (def.assignee === project.pmId || (project.memberIds ?? []).includes(def.assignee))
      )
        assignee = def.assignee
      else {
        assignee = defaultTicketAssignee(project)
        result.notes.push(
          `${def.id}: 담당 ${def.assignee}가 이 프로젝트에 배정되어 있지 않아 기본 담당으로 만들었어요.`
        )
      }

      const key = `${def.id}/${today.date}`
      const have = counts.get(key) ?? 0
      for (let i = have; i < def.count; i++) {
        if (todayTotal >= MAX_RECURRING_PER_DAY) {
          result.notes.push(
            `하루 생성 상한 ${MAX_RECURRING_PER_DAY}건에 도달해 ${def.id}의 ${def.count - i}건을 만들지 않았어요.`
          )
          break
        }
        const created = await this.deps.tickets.createRecurring(
          {
            title:
              renderTemplate(def.titleTemplate, today.date) +
              (def.count > 1 ? ` (${i + 1}/${def.count})` : ''),
            goal: renderTemplate(def.goalTemplate, today.date),
            criteria: def.criteriaTemplates.map((c) => renderTemplate(c, today.date)),
            assignee,
            department: null,
            projectId: project.id
          },
          key,
          def.count
        )
        if (!created.ok) {
          result.notes.push(`${def.id}: 정기 티켓을 만들지 못했어요.`)
          break
        }
        // null은 다른 곳에서 이미 채워졌다는 뜻이라 더 만들지 않는다.
        if (created.value === null) break
        todayTotal++
        result.created.push({ definitionId: def.id, ticketId: created.value.id })
      }
    }
    return result
  }
}
