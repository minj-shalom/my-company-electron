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
    }
  | { type: 'error'; code: RunErrorCode; message: string }
  /** 파싱 불가 라인과 stderr. 버리지 않고 남긴다. */
  | { type: 'log'; source: 'stdout' | 'stderr'; line: string }
  | { type: 'exit'; exitCode: number | null; signal: string | null }

export type RunEvent = RunEventBody & { runId: string }
