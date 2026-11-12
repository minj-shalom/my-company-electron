import {
  PROVIDER_CLI_IDS,
  type DetectState,
  type ProviderCliId,
  type ProviderDetection
} from '../../shared/provider'
import type { SpawnFn } from './cli-runner'
import {
  buildLaunch,
  defaultExecEnv,
  isAllowedProvider,
  resolveExecutable,
  type ExecEnv
} from './executable'
import { PROBE_TIMEOUT_MS, probeOutcome } from './version-probe'

export interface DetectOptions {
  execEnv?: ExecEnv
  spawnFn?: SpawnFn
  timeoutMs?: number
}

/** 사용자에게 보여줄 고정 문구. 경로나 원본 오류 메시지는 넣지 않는다. */
const MESSAGES: Record<DetectState, (name: string) => string> = {
  ok: (n) => `${n} 설치됨`,
  'not-installed': (n) => `${n}을(를) 찾을 수 없습니다. 설치 후 다시 확인하세요.`,
  'exec-failed': (n) => `${n} 실행에 실패했습니다.`,
  timeout: (n) =>
    `${n}이(가) 시간 안에 응답하지 않았습니다. 첫 실행은 느릴 수 있으니 잠시 후 다시 시도하세요.`
}

function result(
  provider: ProviderCliId,
  state: DetectState,
  version: string | null
): ProviderDetection {
  return { provider, state, version, message: MESSAGES[state](provider) }
}

/**
 * 제공자 CLI의 설치 여부와 버전을 확인한다. 실행하는 것은 `--version`뿐이라 로그인이나 사용량과 무관하다.
 * provider는 고정 허용 목록만 받고, 목록 밖이면 미설치로 취급한다 (실행하지 않는다).
 */
export async function detectProvider(
  provider: ProviderCliId,
  options: DetectOptions = {}
): Promise<ProviderDetection> {
  if (!isAllowedProvider(provider)) return result(provider, 'not-installed', null)
  const ctx = options.execEnv ?? defaultExecEnv()
  const exe = resolveExecutable(provider, ctx)
  if (exe === null) return result(provider, 'not-installed', null)
  const launch = buildLaunch(exe, ['--version'], ctx)
  if (launch === null) return result(provider, 'exec-failed', null)
  const outcome = await probeOutcome(
    launch.file,
    launch.args,
    options.spawnFn,
    options.timeoutMs ?? PROBE_TIMEOUT_MS,
    { windowsVerbatimArguments: launch.windowsVerbatimArguments }
  )
  return result(provider, outcome.state, outcome.state === 'ok' ? outcome.version : null)
}

export function detectAllProviders(options: DetectOptions = {}): Promise<ProviderDetection[]> {
  return Promise.all(PROVIDER_CLI_IDS.map((id) => detectProvider(id, options)))
}
