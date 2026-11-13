import { CliRunner, type SpawnFn } from '../cli-runner'
import type { ProviderAdapter, ProviderUsage } from '../types'
import { probeVersion } from '../version-probe'
import { geminiAgentTranslator } from './agent-translator'
import { parseLine } from './parser'
import { extractGeminiUsage } from './usage'

export interface GeminiAdapterOptions {
  /** 회사 폴더. gemini가 여기의 GEMINI.md를 지침으로 읽는다. */
  cwd: string
  command?: string
  spawnFn?: SpawnFn
  onUsage?: (runId: string, usage: ProviderUsage) => void
  /**
   * 자식 프로세스에 통과시킬 추가 환경변수 접두어 (예: `GEMINI_`). 기본은 없음: `GEMINI_API_KEY` 같은 인증 값은
   * 전달하지 않고 CLI의 자체 로그인에 맡긴다. 값은 앱이 읽지 않고 그대로 통과만 시킨다.
   */
  envPrefixes?: readonly string[]
}

/**
 * Gemini CLI(`gemini --prompt=... --output-format stream-json`) 어댑터. 인증은 CLI가 처리하며 ~/.gemini 등 인증 파일은 읽지 않는다.
 * 도구 브리지와 경로 제한 쓰기는 지원하지 않는다: 해당 옵션이 오면 시작하지 않는다 (자동 모드 꺼짐, hr은 제안 카드만).
 */
export class GeminiAdapter implements ProviderAdapter {
  readonly id = 'gemini' as const
  readonly capabilities = { toolBridge: false, pathScopedWrites: false } as const
  readonly agentTranslator = geminiAgentTranslator
  private readonly runner: CliRunner
  private readonly command: string
  private readonly spawnFn: SpawnFn | undefined

  constructor(options: GeminiAdapterOptions) {
    this.command = options.command ?? 'gemini'
    this.spawnFn = options.spawnFn
    const { onUsage } = options
    this.runner = new CliRunner({
      cwd: options.cwd,
      command: this.command,
      displayName: 'gemini',
      spawnFn: options.spawnFn,
      envPrefixes: options.envPrefixes,
      buildArgs: (prompt, tools, hr) => {
        // 지원하지 않는 보안 옵션을 조용히 무시하면 제한이 풀린 채 실행되므로 거부한다.
        if (tools || hr) throw new Error('Gemini does not support tool or hr launch options')
        return [
          // `--prompt=값` 한 인자로 넘겨 프롬프트가 '-'로 시작해도 옵션으로 해석되지 않는다.
          `--prompt=${prompt}`,
          '--output-format',
          'stream-json',
          // 파일 편집만 자동 승인한다. yolo(모든 도구 자동 승인)는 쓰지 않는다.
          '--approval-mode',
          'auto_edit'
        ]
      },
      parseLine,
      onStdoutLine: onUsage
        ? (line, runId) => {
            const usage = extractGeminiUsage(line)
            if (usage) onUsage(runId, usage)
          }
        : undefined
    })
  }

  checkInstall: ProviderAdapter['checkInstall'] = () => probeVersion(this.command, this.spawnFn)
  start: ProviderAdapter['start'] = (req, emit, launch) => this.runner.start(req, emit, launch)
  cancel: ProviderAdapter['cancel'] = (runId) => this.runner.cancel(runId)
  cancelAll: ProviderAdapter['cancelAll'] = () => this.runner.cancelAll()
  extractUsage: ProviderAdapter['extractUsage'] = extractGeminiUsage
}
