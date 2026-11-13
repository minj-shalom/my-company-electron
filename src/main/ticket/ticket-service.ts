import { MAX_TICKET_BODY_CHARS, defaultTicketAssignee, type Ticket } from '../../shared/ticket'
import { PROJECT_ID, type ProjectInfo } from '../../shared/project'
import type { ApiResult, DomainErrorCode } from '../../shared/result'
import { leadingId } from '../repository/ids'
import { metaValue } from '../repository/markdown'
import { parseTicket, TICKET_DIRS } from '../repository/parse-ticket'
import { FsGuardError, MAX_FILE_BYTES, relPath, type SafeFs } from '../repository/safe-fs'
import { parseCreate, parseUpdate, type TicketFields, type UpdateInput } from './ticket-input'
import { renderTicket, rewriteTicket, ticketFileName, type TicketTextFields } from './ticket-text'

export interface TicketServiceDeps {
  fs: SafeFs
  /** 결정 resolve, 티켓 이동, 직원·프로젝트 변경과 같은 쓰기 직렬화 큐 (FileCompanyRepository.runExclusive). */
  exclusive: <T>(task: () => Promise<T>) => Promise<T>
  /** 현재 조직의 직원 id 목록. */
  employeeIds: () => Promise<ReadonlySet<string>>
  /** T-037 프로젝트 목록 (보관 포함). 읽지 못하면 예외를 던진다. */
  projects: () => Promise<ProjectInfo[]>
  /** 쓴 뒤 읽기 위한 조회 (캐시와 무관하게 폴더에서 다시 읽는다). */
  getTicket: (id: string) => Promise<ApiResult<Ticket>>
}

const fail = (code: DomainErrorCode, message: string): ApiResult<never> => ({
  ok: false,
  code,
  message
})

const STATUS_ORDER = ['backlog', 'in-progress', 'done'] as const
const MAX_NUMBER = 999_999
/** `<정의 id>/<YYYY-MM-DD>` */
export const REPEAT_KEY = /^[a-z0-9][a-z0-9-]{0,39}\/\d{4}-\d{2}-\d{2}$/

/** 번호 충돌은 1회만 다시 계산해 시도한다 (CLI 에이전트가 같은 이름을 먼저 만든 경우). */
const CREATE_ATTEMPTS = 2

/**
 * 티켓 생성·편집. 화면과 무관하게 `create(raw)`로 호출할 수 있다 (정기 티켓 T-049가 재사용).
 * 번호 부여와 no-clobber는 이 안에서 한다.
 */
export class TicketService {
  constructor(private readonly deps: TicketServiceDeps) {}

  create(raw: unknown): Promise<ApiResult<Ticket>> {
    const parsed = parseCreate(raw)
    if (!parsed.ok) return Promise.resolve(fail('invalid-request', parsed.message))
    return this.deps.exclusive(() => this.createNow(parsed.value))
  }

  /** 모든 상태 폴더의 `- **반복:** <키>` 줄을 세어 키별 건수를 돌려준다. 읽을 수 없는 파일은 건너뛴다. */
  async scanRepeats(): Promise<Map<string, number>> {
    const counts = new Map<string, number>()
    for (const st of STATUS_ORDER) {
      const { files } = await this.deps.fs.listMarkdown(TICKET_DIRS[st])
      for (const name of files) {
        let key: string | null
        try {
          key = metaValue(await this.deps.fs.readText(relPath(TICKET_DIRS[st], name)), '반복')
        } catch {
          continue
        }
        if (key !== null && REPEAT_KEY.test(key)) counts.set(key, (counts.get(key) ?? 0) + 1)
      }
    }
    return counts
  }

  /**
   * 정기 티켓 한 건 생성 (T-049). 같은 `repeatKey`의 티켓이 이미 `limit`건 이상이면 만들지 않고 `value: null`을 돌려준다.
   * 확인과 생성이 같은 쓰기 큐 안에서 이어져 재시작·동시 실행에도 중복이 생기지 않는다.
   */
  createRecurring(
    raw: unknown,
    repeatKey: string,
    limit: number
  ): Promise<ApiResult<Ticket | null>> {
    const parsed = parseCreate(raw)
    if (!parsed.ok) return Promise.resolve(fail('invalid-request', parsed.message))
    if (!REPEAT_KEY.test(repeatKey))
      return Promise.resolve(fail('invalid-request', '반복 표식이 올바르지 않습니다.'))
    return this.deps.exclusive(async () => {
      try {
        if (((await this.scanRepeats()).get(repeatKey) ?? 0) >= limit)
          return { ok: true, value: null }
      } catch {
        return fail('internal', '티켓을 저장하지 못했습니다.')
      }
      return this.createNow(parsed.value, repeatKey)
    })
  }

  update(raw: unknown): Promise<ApiResult<Ticket>> {
    const parsed = parseUpdate(raw)
    if (!parsed.ok) return Promise.resolve(fail('invalid-request', parsed.message))
    const input = parsed.value
    return this.deps.exclusive(() => this.updateNow(input))
  }

  /** 담당 직원과 프로젝트를 현재 조직·프로젝트 목록과 대조하고 담당 기본값을 채운다. */
  private async resolveRefs(
    f: TicketFields,
    keepProject: string | null
  ): Promise<{ fields: TicketTextFields } | { error: ApiResult<never> }> {
    let project: ProjectInfo | null = null
    if (f.projectId !== null) {
      const found = (await this.deps.projects()).find((p) => p.id === f.projectId) ?? null
      // 보관된 프로젝트는 이미 그 프로젝트에 속한 티켓의 편집에서만 유지된다.
      if (found === null || (found.status === 'archived' && f.projectId !== keepProject))
        return { error: fail('invalid-request', '선택할 수 없는 프로젝트입니다.') }
      project = found
    }
    const assignee = f.assignee === undefined ? defaultTicketAssignee(project) : f.assignee
    if (assignee !== null && !(await this.deps.employeeIds()).has(assignee))
      return { error: fail('invalid-request', '조직에 없는 담당 직원입니다.') }
    return { fields: { ...f, assignee } }
  }

  private async nextNumber(): Promise<number> {
    let max = 0
    for (const st of STATUS_ORDER) {
      const { files, skipped } = await this.deps.fs.listMarkdown(TICKET_DIRS[st])
      // 읽을 수 없는 파일과 링크의 번호도 피한다 (같은 번호를 다시 쓰지 않는다).
      for (const name of [...files, ...skipped]) {
        const id = leadingId(name, 'T')
        if (id) max = Math.max(max, Number(id.slice(2)))
      }
    }
    return max + 1
  }

  private async createNow(
    f: TicketFields,
    repeat: string | null = null
  ): Promise<ApiResult<Ticket>> {
    try {
      const refs = await this.resolveRefs(f, null)
      if ('error' in refs) return refs.error
      for (let attempt = 0; attempt < CREATE_ATTEMPTS; attempt++) {
        const num = await this.nextNumber()
        if (num > MAX_NUMBER) return fail('internal', '티켓 번호를 더 부여할 수 없습니다.')
        const id = `T-${String(num).padStart(3, '0')}`
        const text = renderTicket(id, { ...refs.fields, repeat })
        if (Buffer.byteLength(text, 'utf8') > MAX_FILE_BYTES)
          return fail('invalid-request', '티켓 내용이 너무 깁니다.')
        const path = relPath(TICKET_DIRS.backlog, ticketFileName(num, f.title))
        try {
          await this.deps.fs.writeText(path, text, false)
        } catch (e) {
          if (e instanceof FsGuardError && e.kind === 'exists') continue
          throw e
        }
        return this.deps.getTicket(id)
      }
      return fail('conflict', '같은 번호의 티켓 파일이 이미 있습니다. 다시 시도해 주세요.')
    } catch {
      return fail('internal', '티켓을 저장하지 못했습니다.')
    }
  }

  private async updateNow(input: UpdateInput): Promise<ApiResult<Ticket>> {
    try {
      const { fs } = this.deps
      // 모든 상태 폴더에서 같은 번호를 찾는다. backlog 밖에 하나라도 있으면 진행 중 범위를 바꾸지 않도록 거부한다.
      const copies: Array<{ path: string; name: string; status: (typeof STATUS_ORDER)[number] }> =
        []
      for (const st of STATUS_ORDER) {
        const { files } = await fs.listMarkdown(TICKET_DIRS[st])
        for (const name of files)
          if (name.startsWith(`${input.id}-`) || name === `${input.id}.md`)
            copies.push({ path: relPath(TICKET_DIRS[st], name), name, status: st })
      }
      if (copies.length === 0) return fail('not-found', '티켓을 찾을 수 없습니다.')
      if (copies.some((c) => c.status !== 'backlog'))
        return fail('forbidden', '진행 중이거나 완료된 티켓은 편집할 수 없습니다.')
      if (copies.length > 1) return fail('conflict', '같은 번호의 티켓 파일이 둘 이상 있습니다.')
      const file = copies[0]

      const original = await fs.readText(file.path)
      let current: Ticket
      try {
        current = parseTicket(file.name, original, 'backlog')
      } catch {
        return fail('invalid-request', '읽을 수 없는 티켓은 편집할 수 없습니다.')
      }
      // 화면에 잘려 보인 본문 기준의 편집은 나머지를 잃게 하므로 허용하지 않는다.
      if (original.length > MAX_TICKET_BODY_CHARS)
        return fail('invalid-request', '본문이 너무 길어 앱에서 편집할 수 없습니다.')
      if (original !== input.expectedBody)
        return fail('conflict', '편집하는 사이 티켓이 바뀌었습니다. 다시 불러와 주세요.')

      const projectBefore = projectOf(original)
      const refs = await this.resolveRefs(input, projectBefore)
      if ('error' in refs) return refs.error

      const text = rewriteTicket(original, input.id, refs.fields)
      if (text === null)
        return fail('invalid-request', '이 형식의 티켓은 앱에서 편집할 수 없습니다.')
      if (Buffer.byteLength(text, 'utf8') > MAX_FILE_BYTES)
        return fail('invalid-request', '티켓 내용이 너무 깁니다.')
      // 다시 파싱해 의도한 값으로 읽히는지 확인한다 (frontmatter가 담당·제목을 덮는 형식 등은 거부).
      try {
        const check = parseTicket(file.name, text, 'backlog')
        if (
          check.id !== current.id ||
          check.title !== input.title ||
          check.assignee !== input.assignee ||
          (check.department ?? null) !== input.department
        )
          throw new Error('mismatch')
      } catch {
        return fail('invalid-request', '이 형식의 티켓은 앱에서 편집할 수 없습니다.')
      }
      // 쓰기 직전 다시 읽어 그 사이 외부(CLI 에이전트 등)가 바꿨으면 덮어쓰지 않는다.
      if ((await fs.readText(file.path)) !== original)
        return fail('conflict', '편집하는 사이 티켓이 바뀌었습니다. 다시 불러와 주세요.')
      await fs.writeText(file.path, text, true)
      return this.deps.getTicket(input.id)
    } catch (e) {
      if (e instanceof FsGuardError && e.kind === 'missing')
        return fail('conflict', '편집하는 사이 티켓이 바뀌었습니다. 다시 불러와 주세요.')
      return fail('internal', '티켓을 저장하지 못했습니다.')
    }
  }
}

/** 본문의 `- **프로젝트:** id` 줄 값. 없거나 id 형식이 아니면 null. */
function projectOf(body: string): string | null {
  const raw = metaValue(body, '프로젝트')?.replace(/^`|`$/g, '') ?? null
  return raw !== null && PROJECT_ID.test(raw) ? raw : null
}
