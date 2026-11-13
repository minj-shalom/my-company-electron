import {
  DEFAULT_PROVIDER,
  MAX_PROVIDER_OVERRIDES,
  isProviderCliIdValue,
  type ProviderNotice,
  type ProviderSelection
} from '../../shared/provider-selection'
import type { ProviderCliId, ProviderDetection } from '../../shared/provider'
import { EMPLOYEE_ID } from '../repository/ids'
import type { SafeFs } from '../repository/safe-fs'

export const SELECTION_FILE = 'company/settings/providers.json'

/** 어댑터를 만들지 않고 알 수 있도록 고정해 둔다. 어댑터의 capabilities와 같은지는 테스트가 확인한다. */
export const PROVIDER_CAPABILITIES: Record<
  ProviderCliId,
  { toolBridge: boolean; pathScopedWrites: boolean }
> = {
  claude: { toolBridge: true, pathScopedWrites: true },
  codex: { toolBridge: false, pathScopedWrites: false },
  gemini: { toolBridge: false, pathScopedWrites: false }
}

const KEYS = new Set(['defaultProvider', 'overrides'])

/** 하나라도 잘못되면 null (부분 저장하지 않는다). 알 수 없는 키, 잘못된 직원 id, 허용 목록 밖 제공자는 거부한다. */
export function parseProviderSelection(input: unknown): ProviderSelection | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null
  const obj = input as Record<string, unknown>
  if (Object.keys(obj).some((k) => !KEYS.has(k))) return null
  if (!isProviderCliIdValue(obj['defaultProvider'])) return null
  const raw = obj['overrides']
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const entries = Object.entries(raw as Record<string, unknown>)
  if (entries.length > MAX_PROVIDER_OVERRIDES) return null
  const overrides: Record<string, ProviderCliId> = Object.create(null) as Record<
    string,
    ProviderCliId
  >
  for (const [id, value] of entries) {
    if (!EMPLOYEE_ID.test(id) || !isProviderCliIdValue(value)) return null
    overrides[id] = value
  }
  return { defaultProvider: obj['defaultProvider'], overrides: { ...overrides } }
}

export const EMPTY_SELECTION: ProviderSelection = {
  defaultProvider: DEFAULT_PROVIDER,
  overrides: {}
}

export interface SelectionStore {
  load(): Promise<ProviderSelection>
  save(selection: ProviderSelection): Promise<void>
}

/** 회사 폴더 설정 파일. SafeFs만 쓰므로 경로 탈출이 막힌다. 손상된 파일은 기본값으로 본다. */
export function createSelectionStore(fs: SafeFs): SelectionStore {
  return {
    async load() {
      let raw: string
      try {
        raw = await fs.readText(SELECTION_FILE)
      } catch {
        return EMPTY_SELECTION
      }
      try {
        return parseProviderSelection(JSON.parse(raw)) ?? EMPTY_SELECTION
      } catch {
        return EMPTY_SELECTION
      }
    },
    async save(selection) {
      await fs.writeText(SELECTION_FILE, `${JSON.stringify(selection, null, 2)}\n`)
    }
  }
}

export type ProviderResolution =
  | {
      ok: true
      provider: ProviderCliId
      source: 'employee' | 'company' | 'default'
      /** 이 실행에서 자동 모드를 쓸 수 있는지. 도구 브리지 미지원이면 false (`매번 컨펌`). */
      autoAllowed: boolean
      notices: ProviderNotice[]
    }
  | { ok: false; code: 'provider-unavailable'; message: string }

export type RunRequirementResult =
  | { ok: true }
  | { ok: false; code: 'tool-bridge-unsupported' | 'path-scope-unsupported'; message: string }

/** 실행 전에 capabilities로 걸러, 어댑터가 throw하지 않게 한다. */
export function checkRunRequirements(
  provider: ProviderCliId,
  needs: { tools?: boolean; hr?: boolean }
): RunRequirementResult {
  const caps = PROVIDER_CAPABILITIES[provider]
  if (needs.tools === true && !caps.toolBridge)
    return {
      ok: false,
      code: 'tool-bridge-unsupported',
      message: `${provider}은(는) 도구 연결을 지원하지 않아 이 실행을 시작하지 않았습니다.`
    }
  if (needs.hr === true && !caps.pathScopedWrites)
    return {
      ok: false,
      code: 'path-scope-unsupported',
      message: `${provider}은(는) 쓰기 범위 제한을 지원하지 않아 인사 실행을 시작하지 않았습니다.`
    }
  return { ok: true }
}

/**
 * 우선순위: 직원 > 회사 기본 > claude. 선택한 제공자가 설치되어 있지 않으면(감지 결과 ok가 아님)
 * 회사 기본, claude 순으로 대체하고 안내를 남긴다. 쓸 수 있는 제공자가 없으면 거부한다.
 */
export function resolveProvider(
  selection: ProviderSelection,
  detections: readonly ProviderDetection[],
  employeeId?: string
): ProviderResolution {
  const usable = (p: ProviderCliId): boolean =>
    detections.some((d) => d.provider === p && d.state === 'ok')
  const override = employeeId !== undefined ? selection.overrides[employeeId] : undefined
  const wanted: ProviderCliId = override ?? selection.defaultProvider
  const source = override !== undefined ? 'employee' : 'company'
  const chain = [...new Set<ProviderCliId>([wanted, selection.defaultProvider, DEFAULT_PROVIDER])]
  const picked = chain.find(usable)
  if (picked === undefined)
    return {
      ok: false,
      code: 'provider-unavailable',
      message: '사용할 수 있는 AI 제공자가 없습니다. 설치 상태를 확인하세요.'
    }
  const notices: ProviderNotice[] = []
  if (picked !== wanted)
    notices.push({
      code: 'fallback',
      message: `${wanted}을(를) 쓸 수 없어 ${picked}(으)로 대체해 실행합니다.`
    })
  const autoAllowed = PROVIDER_CAPABILITIES[picked].toolBridge
  if (!autoAllowed)
    notices.push({
      code: 'auto-disabled',
      message: `${picked}은(는) 도구 연결을 지원하지 않아 자동 모드를 쓰지 않고 매번 컨펌합니다.`
    })
  return {
    ok: true,
    provider: picked,
    source: picked !== wanted ? 'default' : source,
    autoAllowed,
    notices
  }
}

export interface SelectionServiceDeps {
  store: SelectionStore
  detect: () => Promise<ProviderDetection[]>
}

/** 한 시점의 설정과 감지 결과. 이 스냅샷으로 만든 어댑터는 이후 설정이 바뀌어도 그대로다. */
export interface SelectionSnapshot {
  resolve(employeeId?: string): ProviderResolution
}

export class ProviderSelectionService {
  constructor(private readonly deps: SelectionServiceDeps) {}

  get(): Promise<ProviderSelection> {
    return this.deps.store.load()
  }

  /** 입력 전체를 검증한 뒤 교체 저장한다. 진행 중인 실행은 이미 만든 어댑터를 쓰므로 영향이 없다. */
  async save(input: unknown): Promise<ProviderSelection | null> {
    const selection = parseProviderSelection(input)
    if (selection === null) return null
    await this.deps.store.save(selection)
    return selection
  }

  /** 다음 실행(틱) 시작 때 한 번 호출한다. */
  async snapshot(): Promise<SelectionSnapshot> {
    const [selection, detections] = await Promise.all([
      this.deps.store.load(),
      this.deps.detect().catch((): ProviderDetection[] => [])
    ])
    const resolve = (employeeId?: string): ProviderResolution =>
      resolveProvider(selection, detections, employeeId)
    return { resolve }
  }
}
