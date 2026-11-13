import type { RunEventBody } from '../../../shared/run'

/**
 * `codex exec --json` JSONL 출력의 가정 형식 (T-023, 설치된 codex-cli 0.166 `--help`와 공개 문서 기준).
 * 이 환경에서 실제 모델을 호출하지 않았으므로 이벤트 스키마는 문서 기준 가정이다 (결정 카드 D-025).
 * 알 수 없는 타입은 버리지 않고 log로 남긴다.
 */
type Json = Record<string, unknown>

function isObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)

function parseItem(phase: 'started' | 'completed', item: Json, raw: string): RunEventBody[] {
  const id = str(item['id']) ?? ''
  switch (item['type']) {
    case 'agent_message': {
      const text = str(item['text'])
      return phase === 'completed' && text !== null
        ? [{ type: 'message', role: 'assistant', text }]
        : []
    }
    case 'command_execution': {
      if (phase === 'started')
        return [
          {
            type: 'tool_use',
            toolUseId: id,
            name: 'command_execution',
            input: { command: item['command'] ?? null }
          }
        ]
      const failed =
        item['status'] === 'failed' ||
        (typeof item['exit_code'] === 'number' && item['exit_code'] !== 0)
      return [
        {
          type: 'tool_result',
          toolUseId: id,
          content: str(item['aggregated_output']) ?? '',
          isError: failed
        }
      ]
    }
    case 'mcp_tool_call': {
      if (phase === 'started')
        return [
          {
            type: 'tool_use',
            toolUseId: id,
            name: `${str(item['server']) ?? 'mcp'}.${str(item['tool']) ?? 'unknown'}`,
            input: item['arguments'] ?? null
          }
        ]
      return [
        { type: 'tool_result', toolUseId: id, content: '', isError: item['status'] === 'failed' }
      ]
    }
    case 'file_change':
      // 파일 변경은 완료 시점에만 온다. 사용과 결과를 한 번에 낸다.
      return phase === 'completed'
        ? [
            {
              type: 'tool_use',
              toolUseId: id,
              name: 'file_change',
              input: { changes: item['changes'] ?? [] }
            },
            {
              type: 'tool_result',
              toolUseId: id,
              content: '',
              isError: item['status'] === 'failed'
            }
          ]
        : []
    case 'web_search':
      return phase === 'completed'
        ? [
            {
              type: 'tool_use',
              toolUseId: id,
              name: 'web_search',
              input: { query: item['query'] ?? null }
            }
          ]
        : []
    case 'reasoning':
    case 'todo_list':
      return []
    case 'error':
      return phase === 'completed'
        ? [{ type: 'log', source: 'stdout', line: str(item['message']) ?? raw }]
        : []
    default:
      return [{ type: 'log', source: 'stdout', line: raw }]
  }
}

/** codex `--json` 한 줄을 이벤트로 변환한다. JSON이 아니면 log. result 이벤트는 turn 종료에서 낸다. */
export function parseLine(line: string): RunEventBody[] {
  let data: unknown
  try {
    data = JSON.parse(line)
  } catch {
    return [{ type: 'log', source: 'stdout', line }]
  }
  if (!isObject(data)) return [{ type: 'log', source: 'stdout', line }]

  switch (data['type']) {
    case 'thread.started':
      return [{ type: 'start', sessionId: str(data['thread_id']), model: null }]
    case 'turn.started':
    case 'item.updated':
      return []
    case 'item.started':
    case 'item.completed': {
      const item = data['item']
      if (!isObject(item)) return [{ type: 'log', source: 'stdout', line }]
      return parseItem(data['type'] === 'item.started' ? 'started' : 'completed', item, line)
    }
    case 'turn.completed':
      // 응답 본문은 앞선 message 이벤트에 있다. 이 파서는 줄 단위 무상태라 text/비용/시간은 비운다.
      return [
        {
          type: 'result',
          success: true,
          subtype: 'success',
          text: '',
          costUsd: null,
          durationMs: null,
          numTurns: 1
        }
      ]
    case 'turn.failed': {
      const err = data['error']
      const message = isObject(err) ? (str(err['message']) ?? '') : ''
      return [
        {
          type: 'result',
          success: false,
          subtype: 'turn_failed',
          text: message,
          costUsd: null,
          durationMs: null,
          numTurns: 1
        }
      ]
    }
    case 'error':
      // 뒤따르는 turn.failed가 실패를 알린다. 여기서는 원인만 로그로 남긴다.
      return [{ type: 'log', source: 'stdout', line: str(data['message']) ?? line }]
    default:
      return [{ type: 'log', source: 'stdout', line }]
  }
}
