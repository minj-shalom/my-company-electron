/** claude CLI 러너 이벤트/요청 타입 (main/preload/renderer 공용). */

export type RunErrorCode =
  | 'invalid-request' // 입력 검증 실패
  | 'cli-not-found' // claude 실행 파일 없음
  | 'spawn-failed' // 그 외 실행 실패
  | 'timeout'
  | 'cancelled'
  | 'exit-nonzero' // 비정상 종료 코드

export interface RunStartRequest {
  prompt: string
  /** 밀리초. 생략하면 main의 기본값을 쓴다. */
  timeoutMs?: number
}

export type RunStartResult =
  { ok: true; runId: string } | { ok: false; code: RunErrorCode; message: string }

/**
 * 비대화형 실행에서 권한이 없어 거부된 동작(Claude `permission_denials`). 값은 main 파서가 길이를 제한한 뒤에만 담는다.
 * 자격 증명을 담지 않으며, 허용 규칙으로 바꿀 수 있는지는 main의 permission 모듈이 따로 검증한다.
 */
export interface PermissionDenial {
  tool: string
  /** Bash 도구의 명령. 없으면 null. */
  command: string | null
  /** 파일 도구의 대상 경로. 없으면 null. */
  path: string | null
}

export type RunEventBody =
  | { type: 'start'; sessionId: string | null; model: string | null }
  | { type: 'message'; role: 'assistant' | 'user'; text: string }
  | { type: 'tool_use'; toolUseId: string; name: string; input: unknown }
  | { type: 'tool_result'; toolUseId: string; content: string; isError: boolean }
  | {
      type: 'result'
      success: boolean
      subtype: string
      text: string
      costUsd: number | null
      durationMs: number | null
      numTurns: number | null
      /** 거부된 동작 목록. 제공자가 알려주지 않으면 없다. */
      denials?: PermissionDenial[]
    }
  | { type: 'error'; code: RunErrorCode; message: string }
  /** 파싱 불가 라인과 stderr. 버리지 않고 남긴다. */
  | { type: 'log'; source: 'stdout' | 'stderr'; line: string }
  | { type: 'exit'; exitCode: number | null; signal: string | null }

export type RunEvent = RunEventBody & { runId: string }
