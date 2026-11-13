import type { PermissionDenial, RunEventBody } from '../../../shared/run'

type Json = Record<string, unknown>

function isObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const num = (v: unknown): number | null => (typeof v === 'number' ? v : null)

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((c) => (isObject(c) && typeof c['text'] === 'string' ? c['text'] : ''))
      .filter((t) => t !== '')
      .join('\n')
  }
  return ''
}

const MAX_DENIALS = 20
const MAX_DENIAL_FIELD = 500

const clip = (v: unknown): string | null =>
  typeof v === 'string' && v.length > 0 ? v.slice(0, MAX_DENIAL_FIELD) : null

/** result 줄의 `permission_denials`에서 도구 이름과 명령/경로만 뽑는다 (나머지 입력 필드는 버린다). */
function parseDenials(v: unknown): PermissionDenial[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out: PermissionDenial[] = []
  for (const d of v.slice(0, MAX_DENIALS)) {
    if (!isObject(d) || typeof d['tool_name'] !== 'string') continue
    const input = isObject(d['tool_input']) ? d['tool_input'] : {}
    out.push({
      tool: d['tool_name'].slice(0, 80),
      command: clip(input['command']),
      path: clip(input['file_path'] ?? input['notebook_path'])
    })
  }
  return out
}

function parseMessage(role: 'assistant' | 'user', msg: unknown): RunEventBody[] {
  if (!isObject(msg)) return []
  const content = msg['content']
  if (typeof content === 'string') return [{ type: 'message', role, text: content }]
  if (!Array.isArray(content)) return []
  const events: RunEventBody[] = []
  for (const block of content) {
    if (!isObject(block)) continue
    const kind = block['type']
    if (kind === 'text' && typeof block['text'] === 'string') {
      events.push({ type: 'message', role, text: block['text'] })
    } else if (kind === 'tool_use') {
      events.push({
        type: 'tool_use',
        toolUseId: str(block['id']) ?? '',
        name: str(block['name']) ?? 'unknown',
        input: block['input'] ?? null
      })
    } else if (kind === 'tool_result') {
      events.push({
        type: 'tool_result',
        toolUseId: str(block['tool_use_id']) ?? '',
        content: contentToText(block['content']),
        isError: block['is_error'] === true
      })
    }
    // thinking 등 알 수 없는 블록은 의도적으로 건너뛴다 (UI 대상 아님).
  }
  return events
}

/**
 * stream-json 한 줄을 이벤트로 변환한다. JSON이 아니거나 객체가 아니면 log 이벤트로 남긴다.
 * 알려진 형식이지만 UI에 필요 없는 타입(rate_limit_event 등)은 빈 배열을 돌려준다.
 */
export function parseLine(line: string): RunEventBody[] {
  let data: unknown
  try {
    data = JSON.parse(line)
  } catch {
    return [{ type: 'log', source: 'stdout', line }]
  }
  if (!isObject(data)) return [{ type: 'log', source: 'stdout', line }]

  switch (data['type']) {
    case 'system':
      // init만 시작 이벤트로 쓴다. init에는 apiKeySource 등이 있으나 전달하지 않는다.
      if (data['subtype'] !== 'init') return []
      return [{ type: 'start', sessionId: str(data['session_id']), model: str(data['model']) }]
    case 'assistant':
      return parseMessage('assistant', data['message'])
    case 'user':
      return parseMessage('user', data['message'])
    case 'result': {
      const denials = parseDenials(data['permission_denials'])
      return [
        {
          type: 'result',
          success: data['subtype'] === 'success' && data['is_error'] !== true,
          subtype: str(data['subtype']) ?? 'unknown',
          text: str(data['result']) ?? '',
          costUsd: num(data['total_cost_usd']),
          durationMs: num(data['duration_ms']),
          numTurns: num(data['num_turns']),
          ...(denials === undefined ? {} : { denials })
        }
      ]
    }
    default:
      // 버전에 따라 늘어나는 타입은 무시하지 않고 원문을 log로 남긴다.
      return data['type'] === 'rate_limit_event' ? [] : [{ type: 'log', source: 'stdout', line }]
  }
}
