import {
  PROVIDER_CLI_IDS,
  type ConnectionTestResult,
  type ProviderCliId,
  type ProviderDetection
} from '../../shared/provider'
import { runConnectionTest, type ConnectionTestOptions } from './connection-test'
import { detectAllProviders, type DetectOptions } from './detect'

export interface ProviderServiceDeps {
  detect?: (options?: DetectOptions) => Promise<ProviderDetection[]>
  test?: (provider: ProviderCliId, options?: ConnectionTestOptions) => Promise<ConnectionTestResult>
}

export function isProviderCliId(value: unknown): value is ProviderCliId {
  return typeof value === 'string' && (PROVIDER_CLI_IDS as readonly string[]).includes(value)
}

/**
 * 감지와 연결 테스트. 연결 테스트는 사용량이 드므로 사용자 요청(IPC)으로만 시작하고,
 * 같은 제공자의 중복 클릭은 진행 중인 실행에 합친다. shutdown()은 진행 중인 자식 프로세스를 끊는다.
 */
export class ProviderService {
  private readonly detectFn: NonNullable<ProviderServiceDeps['detect']>
  private readonly testFn: NonNullable<ProviderServiceDeps['test']>
  private readonly inFlight = new Map<ProviderCliId, Promise<ConnectionTestResult>>()
  private readonly abort = new AbortController()

  constructor(deps: ProviderServiceDeps = {}) {
    this.detectFn = deps.detect ?? detectAllProviders
    this.testFn = deps.test ?? runConnectionTest
  }

  detect(): Promise<ProviderDetection[]> {
    return this.detectFn()
  }

  testConnection(provider: ProviderCliId): Promise<ConnectionTestResult> {
    const running = this.inFlight.get(provider)
    if (running) return running
    const task = this.testFn(provider, { signal: this.abort.signal }).finally(() =>
      this.inFlight.delete(provider)
    )
    this.inFlight.set(provider, task)
    return task
  }

  /** 앱 종료 정리 훅. 이후의 테스트 요청은 시작하지 않고 실패로 끝난다. */
  shutdown(): void {
    this.abort.abort()
  }
}
