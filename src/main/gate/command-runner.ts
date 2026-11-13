import { spawn } from 'node:child_process'
import { buildCliEnv } from '../providers/cli-env'
import { assertSafeArgs } from './git-args'

export interface CommandResult {
  code: number | null
  /** 앞쪽 64KB까지. 호출 측은 파싱에만 쓰고 LLM·로그로 내보내지 않는다. */
  stdout: string
}

export interface CommandOptions {
  cwd: string
  signal?: AbortSignal
  timeoutMs?: number
}

/** 게이트가 git/gh를 실행하는 유일한 통로. 테스트는 가짜 실행기를 주입한다 (실제 push·머지·네트워크 금지). */
export interface CommandRunner {
  run(command: 'git' | 'gh', args: readonly string[], opts: CommandOptions): Promise<CommandResult>
}

const MAX_STDOUT = 64 * 1024
const DEFAULT_TIMEOUT_MS = 60_000
/** 사용자의 git/gh가 자기 인증을 쓰도록 통과만 시키는 변수. 앱은 값을 읽지 않고 기록하지 않는다. */
const PASS_THROUGH = ['SSH_AUTH_SOCK', 'GH_TOKEN', 'GITHUB_TOKEN', 'GH_HOST', 'GH_CONFIG_DIR']

export function createCommandRunner(): CommandRunner {
  return {
    run: (command, args, opts) =>
      new Promise<CommandResult>((resolve, reject) => {
        try {
          assertSafeArgs(command, args)
        } catch (e) {
          reject(e)
          return
        }
        if (opts.signal?.aborted) {
          reject(new Error('aborted'))
          return
        }
        const env = buildCliEnv()
        for (const k of PASS_THROUGH) if (process.env[k] !== undefined) env[k] = process.env[k]
        env.GIT_TERMINAL_PROMPT = '0'
        const child = spawn(command, [...args], {
          cwd: opts.cwd,
          shell: false,
          env,
          stdio: ['ignore', 'pipe', 'ignore']
        })
        let out = ''
        child.stdout.setEncoding('utf8')
        child.stdout.on('data', (c: string) => {
          if (out.length < MAX_STDOUT) out += c
        })
        const stop = (): void => {
          child.kill('SIGTERM')
          setTimeout(() => child.kill('SIGKILL'), 3000).unref()
        }
        const timer = setTimeout(stop, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
        opts.signal?.addEventListener('abort', stop, { once: true })
        child.on('error', (e) => {
          clearTimeout(timer)
          reject(e)
        })
        child.on('close', (code) => {
          clearTimeout(timer)
          opts.signal?.removeEventListener('abort', stop)
          resolve({ code, stdout: out.slice(0, MAX_STDOUT) })
        })
      })
  }
}
