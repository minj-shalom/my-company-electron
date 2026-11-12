import { CliRunner, type SpawnFn } from '../cli-runner'
import type { ProviderAdapter, ProviderUsage } from '../types'
import { probeVersion } from '../version-probe'
import { claudeAgentTranslator } from './agent-translator'
import { parseLine } from './parser'
import { extractClaudeUsage } from './usage'

export interface ClaudeAdapterOptions {
  /** 회사 폴더. claude가 여기의 CLAUDE.md와 .claude/agents/를 그대로 읽는다. */
  cwd: string
  command?: string
  spawnFn?: SpawnFn
  /** 실행이 결과를 내면 비용/토큰 숫자를 전달한다 (기록은 호출 측 책임). */
  onUsage?: (runId: string, usage: ProviderUsage) => void
}

/** Claude Code CLI(`claude -p --output-format stream-json`) 어댑터. */
export class ClaudeAdapter implements ProviderAdapter {
  readonly id = 'claude' as const
  readonly agentTranslator = claudeAgentTranslator
  private readonly runner: CliRunner
  private readonly command: string
  private readonly spawnFn: SpawnFn | undefined

  constructor(options: ClaudeAdapterOptions) {
    this.command = options.command ?? 'claude'
    this.spawnFn = options.spawnFn
    const { onUsage } = options
    this.runner = new CliRunner({
      cwd: options.cwd,
      command: this.command,
      displayName: 'claude',
      spawnFn: options.spawnFn,
      // 프롬프트가 '-'로 시작해도 옵션으로 해석되지 않도록 `--` 뒤에 둔다.
      buildArgs: (prompt) => ['-p', '--output-format', 'stream-json', '--verbose', '--', prompt],
      parseLine,
      onStdoutLine: onUsage
        ? (line, runId) => {
            const usage = extractClaudeUsage(line)
            if (usage) onUsage(runId, usage)
          }
        : undefined
    })
  }

  checkInstall: ProviderAdapter['checkInstall'] = () => probeVersion(this.command, this.spawnFn)
  start: ProviderAdapter['start'] = (req, emit) => this.runner.start(req, emit)
  cancel: ProviderAdapter['cancel'] = (runId) => this.runner.cancel(runId)
  cancelAll: ProviderAdapter['cancelAll'] = () => this.runner.cancelAll()
  extractUsage: ProviderAdapter['extractUsage'] = extractClaudeUsage
}
