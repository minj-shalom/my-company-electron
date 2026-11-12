import type { WindowApi } from '../../shared/api'
import type { RunEvent, RunEventBody } from '../../shared/run'

/**
 * 브라우저 개발 모드 전용. `?mock-run=idle|stream|error|long`으로 실행 이벤트 스트림을 흉내 낸다 (없으면 idle).
 * - stream: 메시지/도구/결과가 천천히 흐르는 한 실행 (취소 가능)
 * - error: 도구 오류와 비정상 종료
 * - long: 5000건을 빠르게 쏟아 윈도잉과 보관 한도를 확인한다
 */
export type RunScenario = 'idle' | 'stream' | 'error' | 'long'
const SCENARIOS: readonly RunScenario[] = ['idle', 'stream', 'error', 'long']

export function parseRunScenario(search: string): RunScenario {
  const v = new URLSearchParams(search).get('mock-run')
  return SCENARIOS.find((s) => s === v) ?? 'idle'
}

const RUN_ID = 'mock-run-1'

export function buildScenarioEvents(scenario: RunScenario): RunEventBody[] {
  const start: RunEventBody = { type: 'start', sessionId: 'mock-session', model: 'mock-model' }
  const exit0: RunEventBody = { type: 'exit', exitCode: 0, signal: null }
  switch (scenario) {
    case 'idle':
      return []
    case 'stream':
      return [
        start,
        { type: 'message', role: 'assistant', text: '티켓을 읽고 작업을 시작할게요.' },
        {
          type: 'tool_use',
          toolUseId: 'u1',
          name: 'Read',
          input: { file_path: 'company/tickets/T-013.md' }
        },
        {
          type: 'tool_result',
          toolUseId: 'u1',
          content: '# T-013: 실행 로그 스트리밍 뷰\n목표: ...',
          isError: false
        },
        {
          type: 'message',
          role: 'assistant',
          text: '<b>HTML은 그대로 글자로</b> 보여요.\n**마크다운**도 렌더링하지 않아요.'
        },
        { type: 'log', source: 'stderr', line: 'warning: 느린 응답을 기다리는 중' },
        {
          type: 'tool_use',
          toolUseId: 'u2',
          name: 'Edit',
          input: { path: 'src/a.ts', change: 'x' }
        },
        { type: 'tool_result', toolUseId: 'u2', content: '적용했어요.', isError: false },
        { type: 'message', role: 'assistant', text: '구현을 마쳤어요.' },
        {
          type: 'result',
          success: true,
          subtype: 'success',
          text: '완료: 로그 뷰를 구현했어요.',
          costUsd: 0.0123,
          durationMs: 12_300,
          numTurns: 4
        },
        exit0
      ]
    case 'error':
      return [
        start,
        { type: 'message', role: 'assistant', text: '빌드를 실행해 볼게요.' },
        { type: 'tool_use', toolUseId: 'e1', name: 'Bash', input: { command: 'npm run build' } },
        {
          type: 'tool_result',
          toolUseId: 'e1',
          content: 'error TS2322: 형식이 맞지 않아요.',
          isError: true
        },
        { type: 'log', source: 'stderr', line: 'npm ERR! code ELIFECYCLE' },
        {
          type: 'error',
          code: 'exit-nonzero',
          message: '내부 경로 /Users/someone/secret 는 화면에 나오면 안 돼요'
        },
        { type: 'exit', exitCode: 1, signal: null }
      ]
    case 'long': {
      const out: RunEventBody[] = [start]
      for (let i = 1; i <= 4997; i++) {
        out.push(
          i % 7 === 0
            ? { type: 'tool_use', toolUseId: `l${i}`, name: 'Grep', input: { pattern: `p${i}` } }
            : i === 100
              ? { type: 'message', role: 'assistant', text: '아주 긴 본문 '.repeat(5000) }
              : { type: 'message', role: 'assistant', text: `긴 로그 ${i}번째 줄` }
        )
      }
      out.push({ type: 'log', source: 'stdout', line: 'end' }, exit0)
      return out
    }
  }
}

type Api = Pick<WindowApi, 'onRunEvent' | 'cancelRun' | 'startRun'>

/** 구독자가 있는 동안만 이벤트를 흘리고, 해제/재구독(StrictMode)해도 이어서 보낸다. */
export function createMockRunApi(scenario: RunScenario, intervalMs: number): Api {
  const events = buildScenarioEvents(scenario)
  const chunk = scenario === 'long' ? 100 : 1
  const delay = scenario === 'long' ? 30 : intervalMs
  const listeners = new Set<(e: RunEvent) => void>()
  let cursor = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let cancelled = false
  const emit = (body: RunEventBody): void => {
    for (const l of listeners) l({ ...body, runId: RUN_ID })
  }
  const tick = (): void => {
    timer = null
    if (listeners.size === 0 || cancelled) return
    for (let i = 0; i < chunk && cursor < events.length; i++) emit(events[cursor++])
    if (cursor < events.length) timer = setTimeout(tick, delay)
  }
  return {
    onRunEvent: (listener) => {
      listeners.add(listener)
      if (timer === null && cursor < events.length && !cancelled) timer = setTimeout(tick, delay)
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0 && timer !== null) {
          clearTimeout(timer)
          timer = null
        }
      }
    },
    cancelRun: async (runId) => {
      if (runId !== RUN_ID || cancelled || cursor >= events.length) return false
      cancelled = true
      emit({ type: 'error', code: 'cancelled', message: 'cancelled' })
      emit({ type: 'exit', exitCode: null, signal: 'SIGTERM' })
      return true
    },
    startRun: async () => ({
      ok: false,
      code: 'cli-not-found',
      message: 'mock: runner unavailable'
    })
  }
}
