import type { RunEventBody } from '../../../shared/run'

/**
 * `gemini -p ... --output-format stream-json` JSONL 출력의 가정 형식 (T-024, 설치된 gemini 0.37.0 `--help`와 공개 문서 기준).
 * 이 환경에서 실제 모델을 호출하지 않았으므로 이벤트 스키마는 문서 기준 가정이다 (결정 카드 D-026).
 * 알 수 없는 줄은 버리지 않고 길이를 제한해 log로 남긴다.
 */
type Json = Record<string, unknown>

export const MAX_LOG_LINE = 2000
export const MAX_MESSAGE_TEXT = 100_000
export const MAX_TOOL_OUTPUT = 20_000
const MAX_TOOL_INPUT_JSON = 10_000

function isObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const cap = (s: string, max: number): string => (s.length > max ? s.slice(0, max) : s)

const log = (line: string): RunEventBody[] => [
  { type: 'log', source: 'stdout', line: cap(line, MAX_LOG_LINE) }
]

/** 도구 인자가 크면 통째로 renderer로 보내지 않고 잘렸다는 표시만 남긴다. */
function limitInput(v: unknown): unknown {
  if (v === undefined) return null
  const json = JSON.stringify(v) ?? 'null'
  return json.length > MAX_TOOL_INPUT_JSON ? { truncated: true, preview: json.slice(0, 500) } : v
}

/** gemini `--output-format stream-json` 한 줄을 이벤트로 변환한다. JSON이 아니면 log. */
export function parseLine(line: string): RunEventBody[] {
  // 거대 줄은 파싱하지 않고 앞부분만 log로 남긴다 (메모리·CPU 보호).
  if (line.length > MAX_MESSAGE_TEXT * 2) return log(line)
  let data: unknown
  try {
    data = JSON.parse(line)
  } catch {
    return log(line)
  }
  if (!isObject(data)) return log(line)

  switch (data['type']) {
    case 'init':
      return [{ type: 'start', sessionId: str(data['session_id']), model: str(data['model']) }]
    case 'message': {
      const role = data['role']
      const text = str(data['content'])
      // 사용자 입력 에코는 무시한다 (프롬프트가 이미 UI에 있다).
      if (role !== 'assistant' || text === null) return role === 'user' ? [] : log(line)
      return [{ type: 'message', role: 'assistant', text: cap(text, MAX_MESSAGE_TEXT) }]
    }
    case 'tool_use':
      return [
        {
          type: 'tool_use',
          toolUseId: str(data['tool_id']) ?? '',
          name: cap(str(data['tool_name']) ?? 'unknown', 200),
          input: limitInput(data['parameters'])
        }
      ]
    case 'tool_result': {
      const err = data['error']
      const isError = data['status'] === 'error' || isObject(err)
      const content =
        isError && isObject(err) ? (str(err['message']) ?? '') : (str(data['output']) ?? '')
      return [
        {
          type: 'tool_result',
          toolUseId: str(data['tool_id']) ?? '',
          content: cap(content, MAX_TOOL_OUTPUT),
          isError
        }
      ]
    }
    case 'error':
      // 경고/오류 알림. 실행 실패는 result(status: error)가 알린다.
      return log(str(data['message']) ?? line)
    case 'result': {
      const ok = data['status'] === 'success'
      const err = data['error']
      const message = isObject(err) ? (str(err['message']) ?? '') : ''
      const stats = isObject(data['stats']) ? data['stats'] : {}
      return [
        {
          type: 'result',
          success: ok,
          subtype: ok ? 'success' : 'error',
          text: cap(message, MAX_LOG_LINE),
          costUsd: null,
          durationMs: num(stats['duration_ms']),
          numTurns: 1
        }
      ]
    }
    default:
      return log(line)
  }
}
