import { CliRunner, type SpawnFn } from '../cli-runner'
import type { ProviderAdapter, ProviderUsage } from '../types'
import { probeVersion } from '../version-probe'
import { codexAgentTranslator } from './agent-translator'
import { parseLine } from './parser'
import { extractCodexUsage } from './usage'

export interface CodexAdapterOptions {
  /** 회사 폴더. codex가 여기의 AGENTS.md를 지침으로 읽는다. */
  cwd: string
  command?: string
  spawnFn?: SpawnFn
  onUsage?: (runId: string, usage: ProviderUsage) => void
}

/**
 * Codex CLI(`codex exec --json`) 어댑터. 인증은 CLI가 처리하며 CODEX_HOME 등 인증 파일은 읽지 않는다.
 * 도구 브리지와 경로 제한 쓰기는 지원하지 않는다: 해당 옵션이 오면 시작하지 않는다 (자동 모드 꺼짐, hr은 제안 카드만).
 */
export class CodexAdapter implements ProviderAdapter {
  readonly id = 'codex' as const
  readonly capabilities = { toolBridge: false, pathScopedWrites: false } as const
  readonly agentTranslator = codexAgentTranslator
  private readonly runner: CliRunner
  private readonly command: string
  private readonly spawnFn: SpawnFn | undefined

  constructor(options: CodexAdapterOptions) {
    this.command = options.command ?? 'codex'
    this.spawnFn = options.spawnFn
    const { onUsage } = options
    this.runner = new CliRunner({
      cwd: options.cwd,
      command: this.command,
      displayName: 'codex',
      spawnFn: options.spawnFn,
      buildArgs: (prompt, tools, hr) => {
        // 지원하지 않는 보안 옵션을 조용히 무시하면 제한이 풀린 채 실행되므로 거부한다.
        if (tools || hr) throw new Error('Codex does not support tool or hr launch options')
        return [
          'exec',
          '--json',
          '--sandbox',
          'workspace-write',
          '--skip-git-repo-check',
          '--ephemeral',
          '--color',
          'never',
          '-C',
          options.cwd,
          // 프롬프트가 '-'로 시작해도 옵션으로 해석되지 않도록 `--` 뒤에 둔다.
          '--',
          prompt
        ]
      },
      parseLine,
      onStdoutLine: onUsage
        ? (line, runId) => {
            const usage = extractCodexUsage(line)
            if (usage) onUsage(runId, usage)
          }
        : undefined
    })
  }

  checkInstall: ProviderAdapter['checkInstall'] = () => probeVersion(this.command, this.spawnFn)
  start: ProviderAdapter['start'] = (req, emit, launch) => this.runner.start(req, emit, launch)
  cancel: ProviderAdapter['cancel'] = (runId) => this.runner.cancel(runId)
  cancelAll: ProviderAdapter['cancelAll'] = () => this.runner.cancelAll()
  extractUsage: ProviderAdapter['extractUsage'] = extractCodexUsage
}
