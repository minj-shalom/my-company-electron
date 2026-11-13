import type { WindowApi } from '../../shared/api'
import type { CredentialAdapterStatus } from '../../shared/publisher'

/**
 * 브라우저 개발 모드 전용. `?mock-credential=disconnected|connected|expiring|no-encryption|error|manual|load-error|loading`.
 * 값(토큰·키)은 어디에도 없다. 상태·만료·표시명만 흉내 낸다. 프로덕션 번들에 넣지 않는다.
 */
export type CredentialScenario =
  | 'disconnected'
  | 'connected'
  | 'expiring'
  | 'no-encryption'
  | 'error'
  | 'manual'
  | 'load-error'
  | 'loading'
const SCENARIOS: readonly CredentialScenario[] = [
  'disconnected',
  'connected',
  'expiring',
  'no-encryption',
  'error',
  'manual',
  'load-error',
  'loading'
]

export function parseCredentialScenario(search: string): CredentialScenario {
  const v = new URLSearchParams(search).get('mock-credential')
  return SCENARIOS.find((s) => s === v) ?? 'connected'
}

const DAY = 86_400_000
const demo = (over: Partial<CredentialAdapterStatus>): CredentialAdapterStatus => ({
  adapterId: 'demo',
  displayName: '데모 블로그',
  scopes: [{ id: 'post:write', description: '글 게시만 허용 (읽기·삭제 없음)' }],
  state: 'disconnected',
  accounts: [],
  encryptionAvailable: true,
  ...over
})

function seed(s: CredentialScenario): CredentialAdapterStatus[] {
  const account = (days: number): CredentialAdapterStatus['accounts'] => [
    {
      accountId: 'demo-blog',
      displayName: '마이컴퍼니 공식 블로그',
      expiresAt: new Date(Date.now() + days * DAY).toISOString()
    }
  ]
  switch (s) {
    case 'connected':
      return [demo({ state: 'connected', accounts: account(60) })]
    case 'expiring':
      return [demo({ state: 'expiring', accounts: account(2) })]
    case 'no-encryption':
      return [demo({ encryptionAvailable: false })]
    case 'error':
      return [demo({ state: 'error', accounts: account(-1) })]
    case 'manual':
      return [
        {
          adapterId: 'manual',
          displayName: '직접 올리기',
          scopes: [],
          state: 'disconnected',
          accounts: [],
          encryptionAvailable: true
        }
      ]
    default:
      return [demo({})]
  }
}

type Mock = Pick<WindowApi, 'getCredentialStatus' | 'disconnectCredential'>

export function createMockCredentialApi(
  scenario: CredentialScenario,
  delayMs = 0
): { api: Mock; reset: () => void } {
  let items = seed(scenario)
  const wait = (): Promise<void> => new Promise((r) => setTimeout(r, delayMs))
  return {
    reset: () => {
      items = seed(scenario)
    },
    api: {
      getCredentialStatus: async () => {
        if (scenario === 'loading') return new Promise(() => undefined)
        await wait()
        if (scenario === 'load-error')
          return { ok: false, code: 'internal', message: '연결 상태를 읽지 못했습니다.' }
        return { ok: true, value: items }
      },
      disconnectCredential: async (req) => {
        await wait()
        const found = items.find((i) => i.adapterId === req.adapterId)
        if (!found) return { ok: false, code: 'invalid-request', message: '알 수 없는 연결입니다.' }
        if (scenario === 'error')
          return { ok: false, code: 'internal', message: '연결을 해제하지 못했습니다.' }
        const status = { ...found, state: 'disconnected' as const, accounts: [] }
        items = items.map((i) => (i.adapterId === req.adapterId ? status : i))
        // 서버 폐기 실패 안내를 볼 수 있게 expiring 시나리오는 revoked:false로 답한다.
        return { ok: true, value: { status, revoked: scenario !== 'expiring' } }
      }
    }
  }
}
