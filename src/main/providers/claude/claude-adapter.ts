import { GATE_SERVER_NAME, GATE_TOOL_NAMES } from '../../../shared/gate'
import { CliRunner, type SpawnFn } from '../cli-runner'
import { HR_TOOLS } from '../../hr/hr-scope'
import type { ProviderAdapter, ProviderUsage, RunHrOptions, RunToolOptions } from '../types'
import { SESSION_ID } from '../session-id'
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

/**
 * hr 전용 실행 인자. 도구는 고정 목록(Bash 없음)이고 MCP 서버는 전혀 붙이지 않는다 (`--strict-mcp-config`에 설정 없음).
 * 경로 규칙은 임시 설정 파일이 담는다.
 */
export function hrArgs(hr: RunHrOptions): string[] {
  if (!SAFE_PATH.test(hr.settingsPath)) throw new Error('Invalid hr settings path')
  return [
    '--settings',
    hr.settingsPath,
    '--tools',
    HR_TOOLS.join(','),
    '--strict-mcp-config',
    '--permission-mode',
    'default'
  ]
}

/** Claude Code CLI(`claude -p --output-format stream-json`) 어댑터. */
export class ClaudeAdapter implements ProviderAdapter {
  readonly id = 'claude' as const
  readonly capabilities = { toolBridge: true, pathScopedWrites: true } as const
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
      buildArgs: (prompt, tools, hr, resume) => {
        if (tools && hr) throw new Error('Tools and hr options are exclusive')
        if (resume !== undefined && !SESSION_ID.test(resume)) throw new Error('Invalid session id')
        return [
          '-p',
          '--output-format',
          'stream-json',
          '--verbose',
          ...(tools ? toolArgs(tools) : []),
          ...(hr ? hrArgs(hr) : []),
          ...(resume !== undefined ? ['--resume', resume] : []),
          '--',
          prompt
        ]
      },
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
