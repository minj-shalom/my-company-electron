import { spawn as nodeSpawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import type {
  ConnectionTestResult,
  ConnectionTestState,
  ProviderCliId
} from '../../shared/provider'
import type { SpawnFn } from './cli-runner'
import {
  buildLaunch,
  defaultExecEnv,
  isAllowedProvider,
  resolveExecutableDetailed,
  type ExecEnv
} from './executable'
import { terminateTree, treeSpawnOptions } from './kill-tree'

/**
 * 사용자가 `연결 테스트`를 눌렀을 때만 호출한다. 자동 경로(시작 시 감지 등)에서 import/호출 금지.
 * 사용량이 드는 짧은 프롬프트 한 번을 실행한다. 로그인 판정은 CLI에 맡기고
 * 인증 파일/토큰은 읽지 않는다 (환경은 상속만 하고 내용을 보지 않는다).
 */
export const CONNECTION_TEST_TIMEOUT_MS = 60_000

/** 한 단어 상수. Windows .cmd 위임 시 인자 주입이 불가능하도록 공백/메타문자가 없는 토큰만 쓴다. */
const TEST_PROMPT = 'ping'

/** 제공자별 고정 인자. 검증된 제공자만 둔다. */
const TEST_ARGS: Partial<Record<ProviderCliId, readonly string[]>> = {
  claude: ['-p', '--output-format', 'text', '--', TEST_PROMPT]
}

const MESSAGES: Record<ConnectionTestState, string> = {
  ok: '연결되었습니다.',
  'not-installed': 'CLI를 찾을 수 없습니다.',
  'exec-failed': 'CLI 실행에 실패했습니다.',
  timeout: '시간 안에 응답하지 않았습니다.',
  failed: '응답을 받지 못했습니다. CLI에 로그인했는지 터미널에서 확인하세요.',
  unsupported: '이 제공자의 연결 테스트는 아직 지원하지 않습니다.'
}

export interface ConnectionTestOptions {
  execEnv?: ExecEnv
  spawnFn?: SpawnFn
  timeoutMs?: number
  /** 기본값은 OS 임시 디렉터리. */
  cwd?: string
}

function done(provider: ProviderCliId, state: ConnectionTestState): ConnectionTestResult {
  return { provider, state, message: MESSAGES[state] }
}

export function runConnectionTest(
  provider: ProviderCliId,
  options: ConnectionTestOptions = {}
): Promise<ConnectionTestResult> {
  if (!isAllowedProvider(provider)) return Promise.resolve(done(provider, 'unsupported'))
  const args = TEST_ARGS[provider]
  if (!args) return Promise.resolve(done(provider, 'unsupported'))
  const ctx = options.execEnv ?? defaultExecEnv()
  const found = resolveExecutableDetailed(provider, ctx)
  if (found.kind === 'missing') return Promise.resolve(done(provider, 'not-installed'))
  if (found.kind === 'not-executable') return Promise.resolve(done(provider, 'exec-failed'))
  const launch = buildLaunch(found.path, args, ctx)
  if (launch === null) return Promise.resolve(done(provider, 'exec-failed'))
  const spawnFn = options.spawnFn ?? nodeSpawn

  return new Promise((resolve) => {
    let child
    try {
      child = spawnFn(launch.file, launch.args, {
        shell: false,
        // 앱/회사 폴더의 CLAUDE.md나 프로젝트 설정을 읽지 않도록 빈 작업 디렉터리에서 실행한다.
        cwd: options.cwd ?? tmpdir(),
        ...treeSpawnOptions(ctx),
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsVerbatimArguments: launch.windowsVerbatimArguments
      })
    } catch {
      resolve(done(provider, 'exec-failed'))
      return
    }
    let settled = false
    const finish = (state: ConnectionTestState): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(done(provider, state))
    }
    const timer = setTimeout(() => {
      terminateTree(child, ctx, { spawnFn: options.spawnFn })
      finish('timeout')
    }, options.timeoutMs ?? CONNECTION_TEST_TIMEOUT_MS)
    let gotOutput = false
    // 출력은 버리고 "응답이 있었는지"만 본다 (본문을 보관하거나 반환하지 않는다).
    child.stdout?.on('data', (chunk: Buffer | string) => {
      if (chunk.length > 0) gotOutput = true
    })
    child.on('error', (err: NodeJS.ErrnoException) =>
      finish(err.code === 'ENOENT' ? 'not-installed' : 'exec-failed')
    )
    child.on('close', (code) => finish(code === 0 && gotOutput ? 'ok' : 'failed'))
  })
}
