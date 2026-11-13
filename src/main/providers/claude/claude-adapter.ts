import { GATE_SERVER_NAME, GATE_TOOL_NAMES } from '../../../shared/gate'
import { CliRunner, type SpawnFn } from '../cli-runner'
import type { ProviderAdapter, ProviderUsage, RunToolOptions } from '../types'
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

const SAFE_PATH = /^\/[^\0\r\n]+$|^[A-Za-z]:[\\/][^\0\r\n]+$/

/** 도구 옵션을 CLI 인자로 바꾼다. 허용 목록 이름은 `mcp__gate__<도구>`로 고정하고 경로는 절대 경로만 받는다. */
export function toolArgs(tools: RunToolOptions): string[] {
  if (!SAFE_PATH.test(tools.toolConfigPath) || !SAFE_PATH.test(tools.settingsPath))
    throw new Error('Invalid tool config path')
  if (
    tools.allowedTools.length === 0 ||
    tools.allowedTools.some((t) => !GATE_TOOL_NAMES.includes(t))
  )
    throw new Error('Invalid tool list')
  return [
    '--mcp-config',
    tools.toolConfigPath,
    '--strict-mcp-config',
    '--settings',
    tools.settingsPath,
    '--allowedTools',
    tools.allowedTools.map((t) => `mcp__${GATE_SERVER_NAME}__${t}`).join(',')
  ]
}

/** Claude Code CLI(`claude -p --output-format stream-json`) 어댑터. */
export class ClaudeAdapter implements ProviderAdapter {
  readonly id = 'claude' as const
  readonly capabilities = { toolBridge: true } as const
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
      buildArgs: (prompt, tools) => [
        '-p',
        '--output-format',
        'stream-json',
        '--verbose',
        ...(tools ? toolArgs(tools) : []),
        '--',
        prompt
      ],
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
  start: ProviderAdapter['start'] = (req, emit, launch) => this.runner.start(req, emit, launch)
  cancel: ProviderAdapter['cancel'] = (runId) => this.runner.cancel(runId)
  cancelAll: ProviderAdapter['cancelAll'] = () => this.runner.cancelAll()
  extractUsage: ProviderAdapter['extractUsage'] = extractClaudeUsage
}
