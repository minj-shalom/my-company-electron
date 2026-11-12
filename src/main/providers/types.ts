import type { RunErrorCode, RunEvent } from '../../shared/run'

export type ProviderId = 'claude'

export type StartResult =
  { ok: true; runId: string } | { ok: false; code: RunErrorCode; message: string }

/**
 * 제공자 CLI 어댑터 공통 계약. 모든 제공자의 출력은 shared/run.ts의 RunEvent로 변환해 emit한다.
 * 인증은 각 CLI가 처리하며 어댑터는 토큰·로그인 정보를 읽거나 저장하지 않는다.
 */
export interface ProviderAdapter {
  readonly id: ProviderId
  /** CLI 설치 여부와 버전을 확인한다. 실행 실패는 예외 대신 installed: false로 돌려준다. */
  checkInstall(): Promise<ProviderInstallStatus>
  /** 입력 검증 후 CLI를 실행한다. 이벤트는 emit으로 흘려보내고 마지막은 항상 exit 이벤트다. */
  start(req: unknown, emit: (event: RunEvent) => void): StartResult
  /** 진행 중인 실행을 취소한다. 알 수 없는 runId면 false. */
  cancel(runId: string): boolean
  cancelAll(): void
  /** CLI 출력 한 줄에서 비용/토큰 숫자만 뽑는다. 사용량이 없는 줄은 null. */
  extractUsage(line: string): ProviderUsage | null
  /** 직원 정의를 이 제공자의 형식으로 변환한다. */
  readonly agentTranslator: AgentDefinitionTranslator
}

export interface ProviderInstallStatus {
  installed: boolean
  /** `--version` 출력의 첫 줄. 설치되지 않았거나 읽지 못하면 null. */
  version: string | null
}

/** 사용량 기록용 숫자만 담는다. 인증·계정 관련 필드는 타입에도 없다. */
export interface ProviderUsage {
  costUsd: number | null
  durationMs: number | null
  numTurns: number | null
  inputTokens: number | null
  outputTokens: number | null
  cacheReadTokens: number | null
  cacheCreationTokens: number | null
}

/** 제공자 중립 직원 정의. 원본은 회사 폴더의 `.claude/agents/*.md`. */
export interface AgentDefinition {
  name: string
  description: string
  tools: string[] | null
  model: string | null
  /** 서브에이전트 본문(시스템 프롬프트). */
  prompt: string
}

/** 직원 정의를 제공자 CLI가 읽는 파일로 바꾼 결과. 경로는 작업 디렉터리 기준 상대 경로. */
export interface TranslatedAgentFile {
  relativePath: string
  content: string
}

/** 직원 정의를 제공자별 형식으로 변환하는 지점. 순수 함수이며 파일은 호출 측이 쓴다. */
export interface AgentDefinitionTranslator {
  translate(agents: readonly AgentDefinition[]): TranslatedAgentFile[]
}
