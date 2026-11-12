import { validateCompanyName } from '../../../shared/company-name'
import type { WindowApi } from '../../../shared/api'
import type { CompanyInfo, CompanyOpenResult, CompanyState } from '../../../shared/company'

type CompanyApi = Pick<
  WindowApi,
  'getCurrentCompany' | 'selectCompanyFolder' | 'createCompany' | 'openCompany'
>

/** 시작 시 화면 분기. 내부 경로는 담지 않고 폴더 이름만 쓴다. */
export type GateState =
  | { kind: 'loading' }
  | { kind: 'start' }
  | { kind: 'notice'; reason: 'missing' | 'invalid'; name: string }
  | { kind: 'open'; company: CompanyInfo; fresh: boolean }
  | { kind: 'error'; message: string }

export type ActionResult =
  | { kind: 'opened'; company: CompanyInfo; fresh: boolean }
  | { kind: 'cancelled' }
  | { kind: 'error'; message: string; field?: 'name' }

const OPEN_MESSAGES: Record<string, string> = {
  'invalid-request': '요청이 올바르지 않아요. 다시 시도해 주세요.',
  'invalid-path': '이 위치는 쓸 수 없어요. 다른 폴더를 골라 주세요.',
  'path-not-allowed': '폴더를 다시 골라 주세요. 선택한 폴더만 열 수 있어요.',
  'not-found': '회사 폴더를 찾을 수 없어요. 폴더가 옮겨지거나 지워졌는지 확인해 주세요.',
  'not-company': '회사 폴더가 아니에요. 회사 설정 파일이 들어 있는 폴더를 골라 주세요.',
  'already-open': '이미 다른 회사가 열려 있어요. 앱을 다시 시작해 주세요.',
  'open-failed': '회사를 열지 못했어요. 잠시 후 다시 시도해 주세요.'
}

const CREATE_MESSAGES: Record<string, string> = {
  'invalid-request': '요청이 올바르지 않아요. 다시 시도해 주세요.',
  'invalid-name': '회사 이름을 사용할 수 없어요. 글자와 숫자 위주로 짧게 지어 주세요.',
  'invalid-path': '이 위치에는 만들 수 없어요. 다른 폴더를 골라 주세요.',
  'already-exists': '같은 이름의 폴더가 이미 있어요. 다른 이름을 쓰거나 다른 위치를 골라 주세요.',
  'path-not-allowed': '위치를 다시 골라 주세요. 선택한 폴더에만 만들 수 있어요.',
  'create-failed': '회사 폴더를 만들지 못했어요. 잠시 후 다시 시도해 주세요.'
}

const UNKNOWN_MESSAGE = '알 수 없는 문제가 생겼어요. 잠시 후 다시 시도해 주세요.'

export function openErrorMessage(code: string): string {
  return OPEN_MESSAGES[code] ?? UNKNOWN_MESSAGE
}

export function createErrorMessage(code: string): string {
  return CREATE_MESSAGES[code] ?? UNKNOWN_MESSAGE
}

export function stateToGate(state: CompanyState): GateState {
  switch (state.status) {
    case 'open':
      return { kind: 'open', company: state.company, fresh: false }
    case 'missing':
      return { kind: 'notice', reason: 'missing', name: state.name }
    case 'invalid':
      return { kind: 'notice', reason: 'invalid', name: state.name }
    default:
      return { kind: 'start' }
  }
}

const FAILED_LOAD = '마지막 회사를 확인하지 못했어요. 다시 확인해 주세요.'

/** 한 번 조회한다. 예외는 사용자 문구로 바꾸고 원문은 노출하지 않는다. */
export async function loadCompanyState(
  api: Pick<CompanyApi, 'getCurrentCompany'>
): Promise<GateState> {
  try {
    return stateToGate(await api.getCurrentCompany())
  } catch {
    return { kind: 'error', message: FAILED_LOAD }
  }
}

/**
 * 시작 시 조회. main은 복원이 5초 안에 끝나지 않으면 none을 줄 수 있어서,
 * none이면 잠시 뒤 한 번만 더 조회한다.
 */
export async function loadCompanyOnStartup(
  api: Pick<CompanyApi, 'getCurrentCompany'>,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))
): Promise<GateState> {
  const first = await loadCompanyState(api)
  if (first.kind !== 'start') return first
  await wait(1500)
  return loadCompanyState(api)
}

function fromOpen(r: CompanyOpenResult, fresh: boolean): ActionResult {
  return r.ok
    ? { kind: 'opened', company: r.company, fresh }
    : { kind: 'error', message: openErrorMessage(r.code) }
}

export async function createAndOpenCompany(
  api: CompanyApi,
  rawName: string
): Promise<ActionResult> {
  const name = rawName.trim()
  const invalid = name.length === 0 ? '회사 이름을 입력해 주세요.' : validateCompanyName(name)
  if (invalid) return { kind: 'error', message: invalid, field: 'name' }
  try {
    const location = await api.selectCompanyFolder('create-location')
    if (location === null) return { kind: 'cancelled' }
    const created = await api.createCompany({ name, path: location })
    if (!created.ok) {
      const nameProblem = created.code === 'invalid-name' || created.code === 'already-exists'
      return {
        kind: 'error',
        message: createErrorMessage(created.code),
        ...(nameProblem ? { field: 'name' as const } : {})
      }
    }
    return fromOpen(await api.openCompany({ path: created.companyDir }), true)
  } catch {
    return { kind: 'error', message: UNKNOWN_MESSAGE }
  }
}

export async function openExistingCompany(api: CompanyApi): Promise<ActionResult> {
  try {
    const folder = await api.selectCompanyFolder('open')
    if (folder === null) return { kind: 'cancelled' }
    return fromOpen(await api.openCompany({ path: folder }), false)
  } catch {
    return { kind: 'error', message: UNKNOWN_MESSAGE }
  }
}

/** 화면 종류. 열린 회사는 새로 만든 경우에만 온보딩을 거친다. */
export type Screen = 'loading' | 'start' | 'onboarding' | 'shell'

export function screenFor(gate: GateState, onboarded: boolean): Screen {
  if (gate.kind === 'loading') return 'loading'
  if (gate.kind === 'open') return gate.fresh && !onboarded ? 'onboarding' : 'shell'
  return 'start'
}

/** 만들기/열기 결과를 화면 상태에 반영한다. 취소는 아무것도 바꾸지 않는다. */
export function applyAction(
  gate: GateState,
  r: ActionResult
): { gate: GateState; error?: { message: string; field?: 'name' } } {
  if (r.kind === 'opened') return { gate: { kind: 'open', company: r.company, fresh: r.fresh } }
  if (r.kind === 'error') return { gate, error: { message: r.message, field: r.field } }
  return { gate }
}

/** "마지막 회사 확인" 결과. 여전히 열 회사가 없으면 안내 문구를 함께 돌려준다. */
export function applyRecheck(g: GateState): {
  gate: GateState | null
  error?: string
  info?: string
} {
  if (g.kind === 'error') return { gate: null, error: g.message }
  if (g.kind === 'start') return { gate: g, info: '저장된 회사가 없어요.' }
  if (g.kind === 'notice') return { gate: g, info: '아직 회사 폴더를 찾을 수 없어요.' }
  return { gate: g }
}
