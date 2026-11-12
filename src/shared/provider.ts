/** AI CLI 제공자 감지/연결 테스트 결과 타입 (main/preload/renderer 공용). */

/** 감지 대상 CLI. 고정 허용 목록이며 사용자 입력이 명령 이름이 되는 일은 없다. */
export const PROVIDER_CLI_IDS = ['claude', 'codex', 'gemini'] as const
export type ProviderCliId = (typeof PROVIDER_CLI_IDS)[number]

export type DetectState =
  | 'ok' // 실행되었고 버전을 읽었다
  | 'not-installed' // 실행 파일을 찾지 못했다
  | 'exec-failed' // 찾았지만 실행에 실패했다 (권한, 비정상 종료 등)
  | 'timeout' // 시간 안에 응답하지 않았다 (첫 실행 지연 등)

/** message는 고정 문구다. 경로나 원본 오류 메시지를 담지 않는다. */
export interface ProviderDetection {
  provider: ProviderCliId
  state: DetectState
  /** `--version` 출력의 첫 줄. state가 ok일 때만 값이 있을 수 있다. */
  version: string | null
  message: string
}

export type ConnectionTestState = 'ok' | DetectState | 'failed' | 'unsupported'

/** 사용자가 누른 `연결 테스트`의 결과. CLI 출력 본문은 담지 않는다. */
export interface ConnectionTestResult {
  provider: ProviderCliId
  state: ConnectionTestState
  message: string
}
