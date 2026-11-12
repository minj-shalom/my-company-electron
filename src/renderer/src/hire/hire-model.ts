import type { WindowApi } from '../../../shared/api'
import {
  FIRST_HIRE_ROLES,
  type FirstHireResult,
  type FirstHireRole
} from '../../../shared/company-hire'
import type { EmployeeCreateRequest } from '../../../shared/employee-change'
import type { OrgSnapshot } from '../../../shared/org'
import { runExclusive } from '../lib/refresh'
import type { ApiResult, DomainErrorCode } from '../../../shared/result'

/** 템플릿 목록에서 설명을 못 받았을 때 쓰는 문구. 직원 이름과 역할은 항상 이 표를 기준으로 보여 준다. */
export const ROLE_COPY: Record<FirstHireRole, { title: string; role: string; note: string }> = {
  pm: {
    title: 'PM',
    role: '목표를 티켓으로 분해하고 우선순위와 진행을 관리해요.',
    note: '프로젝트를 열려면 PM이 꼭 필요해요.'
  },
  developer: {
    title: '개발자',
    role: '티켓에 맞춰 구현하고 테스트해요.',
    note: '프로젝트 성격에 따라 필요 없을 수도 있어요. 나중에 인사팀에 요청해도 돼요.'
  }
}

export interface HireCard {
  id: FirstHireRole
  title: string
  role: string
  description: string
  note: string
  /** 이미 조직에 있어 채용할 필요가 없다. */
  exists: boolean
}

export type FirstHireLoad =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | {
      kind: 'ready'
      cards: HireCard[]
      /** 감지된 제공자 CLI가 하나라도 있는지. 감지를 못 했으면 null (안내만 생략). */
      providerReady: boolean | null
    }

const LOAD_ERROR = '추천 직원 정보를 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.'

/** main의 normalizeTitle(employee-service)과 같은 규칙: 앞뒤 공백 제거 + 소문자. */
export const normalizeTitle = (t: string): string => t.trim().toLowerCase()

/** main과 같이 직원 파일 id 또는 직급(템플릿 직급 PM/개발자, 정규화 비교)이 같으면 이미 있는 것으로 본다. */
export function existingRoles(snapshot: OrgSnapshot): Set<FirstHireRole> {
  return new Set(
    FIRST_HIRE_ROLES.filter((r) =>
      snapshot.org.members.some(
        (m) => m.agentId === r || normalizeTitle(m.title) === normalizeTitle(ROLE_COPY[r].title)
      )
    )
  )
}

export async function loadFirstHire(
  api: Pick<WindowApi, 'listEmployeeTemplates' | 'getOrg' | 'detectProviders'>
): Promise<FirstHireLoad> {
  try {
    const [templates, org, detection] = await Promise.all([
      api.listEmployeeTemplates(),
      api.getOrg(),
      // 감지 실패는 안내를 줄일 뿐 화면을 막지 않는다.
      api.detectProviders().catch(() => null)
    ])
    if (!templates.ok || !org.ok) return { kind: 'error', message: LOAD_ERROR }
    const have = existingRoles(org.value)
    const cards = FIRST_HIRE_ROLES.map((id): HireCard => {
      const t = templates.value.find((x) => x.id === id)
      const copy = ROLE_COPY[id]
      return {
        id,
        title: t?.title ?? copy.title,
        role: copy.role,
        description: t?.description ?? copy.role,
        note: copy.note,
        exists: have.has(id)
      }
    })
    const providerReady = detection?.ok ? detection.value.some((d) => d.state === 'ok') : null
    return { kind: 'ready', cards, providerReady }
  } catch {
    return { kind: 'error', message: LOAD_ERROR }
  }
}

/** 선택된 직원 중 아직 없는 직원만 채용 순서(pm 먼저)대로 돌려준다. */
export function rolesToHire(
  cards: readonly HireCard[],
  selected: ReadonlySet<string>
): FirstHireRole[] {
  return cards.filter((c) => !c.exists && selected.has(c.id)).map((c) => c.id)
}

/** 처음 선택 상태: 없는 pm만 켠다. 개발자는 프로젝트에 따라 불필요할 수 있어 CEO가 직접 고른다. */
export function defaultSelection(cards: readonly HireCard[]): Set<FirstHireRole> {
  return new Set(cards.filter((c) => c.id === 'pm' && !c.exists).map((c) => c.id))
}

/** '인사팀에 요청'은 요청 파일(T-052)이 생기기 전까지 쓸 수 없다. 이유를 화면에 그대로 보여 준다. */
export function requestAvailability(providerReady: boolean | null): {
  enabled: boolean
  reason: string
} {
  const base = '인사팀 요청 기능을 준비하고 있어요. 준비되면 여기서 바로 요청할 수 있어요.'
  return {
    enabled: false,
    reason:
      providerReady === false
        ? `${base} AI 제공자도 아직 연결되지 않아서, 지금은 바로 채용으로 시작할 수 있어요.`
        : base
  }
}

const ERROR_TEXT: Partial<Record<DomainErrorCode, string>> = {
  conflict: '같은 직원이 이미 있어요. 조직도를 새로 불러와 확인해 주세요.',
  'approval-required': '이 변경은 앱에서 바로 할 수 없어요. COO에게 요청해 주세요.',
  forbidden: '이 직원은 앱에서 바꿀 수 없어요.',
  'no-company': '열린 회사가 없어요. 회사를 다시 열어 주세요.',
  'invalid-request': '요청이 올바르지 않아요. 앱을 다시 시작해 주세요.',
  'not-implemented': '이 버전의 앱은 아직 이 기능을 지원하지 않아요.'
}

/** main의 message는 쓰지 않고 코드별 문장만 보여 준다 (내부 표현이 섞일 수 있다). */
export function hireErrorText(code: unknown): string {
  return (
    (typeof code === 'string' && Object.hasOwn(ERROR_TEXT, code)
      ? ERROR_TEXT[code as DomainErrorCode]
      : undefined) ?? '채용하지 못했어요. 바뀐 것은 없어요. 잠시 뒤 다시 시도해 주세요.'
  )
}

export type HireOutcome =
  | { kind: 'done'; message: string; hired: FirstHireRole[]; skipped: FirstHireRole[] }
  | { kind: 'error'; message: string }

function titleOf(role: FirstHireRole): string {
  return ROLE_COPY[role].title
}

export function describeFirstHire(result: FirstHireResult): HireOutcome {
  const hired = result.records
    .map((r) => r.employeeId)
    .filter((id): id is FirstHireRole => (FIRST_HIRE_ROLES as readonly string[]).includes(id))
  const skipped = result.skipped
  const parts: string[] = []
  if (hired.length > 0) parts.push(`${hired.map(titleOf).join(', ')}을(를) 채용했어요.`)
  if (skipped.length > 0)
    parts.push(`${skipped.map(titleOf).join(', ')}은(는) 이미 있어 건너뛰었어요.`)
  return {
    kind: 'done',
    message: parts.join(' ') || '새로 채용한 직원은 없어요.',
    hired,
    skipped
  }
}

export async function runFirstHire(
  api: Pick<WindowApi, 'firstHire'>,
  roles: FirstHireRole[]
): Promise<HireOutcome> {
  try {
    const r = await api.firstHire({ roles })
    return r.ok ? describeFirstHire(r.value) : { kind: 'error', message: hireErrorText(r.code) }
  } catch {
    return { kind: 'error', message: hireErrorText(undefined) }
  }
}

/** 인사팀 추가 요청. 기본 조직의 hr과 같은 값(템플릿 hr, 부서 인사팀, 보고 대상 COO)이다. */
export const HR_ADD_REQUEST: EmployeeCreateRequest = {
  templateId: 'hr',
  id: 'hr',
  department: '인사팀',
  reportsTo: 'COO'
}

export function needsHr(snapshot: OrgSnapshot): boolean {
  return snapshot.missingBaseRoles.includes('hr')
}

/** pm이 없으면 첫 채용이 필요하다 (프로젝트를 열려면 PM이 필요하다). */
export function needsFirstHire(snapshot: OrgSnapshot): boolean {
  return !existingRoles(snapshot).has('pm')
}

export async function runHrAdd(api: Pick<WindowApi, 'createEmployee'>): Promise<HireOutcome> {
  try {
    const r: ApiResult<unknown> = await api.createEmployee({ ...HR_ADD_REQUEST })
    return r.ok
      ? { kind: 'done', message: '인사팀을 추가했어요.', hired: [], skipped: [] }
      : { kind: 'error', message: hireErrorText(r.code) }
  } catch {
    return { kind: 'error', message: hireErrorText(undefined) }
  }
}

/** 인사팀 추가 연타 방지. 이미 처리 중이면 API를 호출하지 않고 null. */
export async function addHrOnce(
  lock: { current: boolean },
  api: Pick<WindowApi, 'createEmployee'>,
  onBusy?: () => void
): Promise<HireOutcome | null> {
  const r = await runExclusive(lock, async () => {
    onBusy?.()
    return runHrAdd(api)
  })
  return r.ran ? r.value : null
}
