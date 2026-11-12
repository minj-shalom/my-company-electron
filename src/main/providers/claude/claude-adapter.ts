import { CliRunner, type SpawnFn } from '../cli-runner'
import type { ProviderAdapter } from '../types'
import { parseLine } from './parser'

export interface ClaudeAdapterOptions {
  /** 회사 폴더. claude가 여기의 CLAUDE.md와 .claude/agents/를 그대로 읽는다. */
  cwd: string
  command?: string
  spawnFn?: SpawnFn
}

/** Claude Code CLI(`claude -p --output-format stream-json`) 어댑터. */
export class ClaudeAdapter implements ProviderAdapter {
  readonly id = 'claude' as const
  private readonly runner: CliRunner

  constructor(options: ClaudeAdapterOptions) {
    this.runner = new CliRunner({
      cwd: options.cwd,
      command: options.command ?? 'claude',
      displayName: 'claude',
      spawnFn: options.spawnFn,
      // 프롬프트가 '-'로 시작해도 옵션으로 해석되지 않도록 `--` 뒤에 둔다.
      buildArgs: (prompt) => ['-p', '--output-format', 'stream-json', '--verbose', '--', prompt],
      parseLine
    })
  }

  start: ProviderAdapter['start'] = (req, emit) => this.runner.start(req, emit)
  cancel: ProviderAdapter['cancel'] = (runId) => this.runner.cancel(runId)
  cancelAll: ProviderAdapter['cancelAll'] = () => this.runner.cancelAll()
}
