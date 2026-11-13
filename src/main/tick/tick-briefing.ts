import { fenceFor } from './tick-fence'
import type { Skip } from './tick-plan'

export type TickOutcome = 'ok' | 'failed' | 'timeout' | 'cancelled' | 'idle' | 'blocked'

export interface BriefingInput {
  at: Date
  trigger: string
  outcome: TickOutcome
  ticketId: string | null
  /** 실행 결과 요약(모델 응답). 신뢰하지 않는 텍스트라 길이를 제한하고 코드 블록에 담는다. */
  resultText: string | null
  failure: string | null
  skipped: Skip[]
  notes: string[]
  decisions: string[]
}

const OUTCOME_LABEL: Record<TickOutcome, string> = {
  ok: '완료',
  failed: '실패',
  timeout: '시간 초과',
  cancelled: '취소됨',
  idle: '할 일 없음',
  blocked: '실행하지 않음'
}
const MAX_RESULT_CHARS = 4000
// 줄바꿈과 탭은 남기고 나머지 제어 문자를 지운다.
const clean = (v: string): string =>
  Array.from(v)
    .filter((c) => {
      const n = c.charCodeAt(0)
      return n === 9 || n === 10 || (n >= 32 && n !== 127)
    })
    .join('')

export function briefingId(at: Date, attempt: number): string {
  const s = at.toISOString().replace(/\D/g, '').slice(0, 14)
  return attempt === 0 ? `briefing-${s}` : `briefing-${s}-${attempt + 1}`
}

/** 한 일 / 결과 / 막힌 점 / 결정 요청 순서의 CEO용 브리핑. */
export function renderBriefing(i: BriefingInput): string {
  const date = i.at.toISOString()
  const out = [
    `# 틱 브리핑 ${date.slice(0, 16).replace('T', ' ')} UTC`,
    '',
    `- **실행 방식:** ${i.trigger}`,
    `- **결과:** ${OUTCOME_LABEL[i.outcome]}`,
    `- **티켓:** ${i.ticketId ?? '없음'}`,
    '',
    '## 한 일'
  ]
  out.push(
    i.ticketId !== null && (i.outcome === 'ok' || i.outcome === 'failed' || i.outcome === 'timeout')
      ? `- ${i.ticketId} 실행`
      : '- 실행한 작업 없음'
  )
  out.push('', '## 결과')
  if (i.resultText) {
    const text = clean(i.resultText).slice(0, MAX_RESULT_CHARS)
    const fence = fenceFor(text)
    out.push(`${fence}text`, text, fence)
  } else out.push(`- ${OUTCOME_LABEL[i.outcome]}`)
  out.push('', '## 막힌 점')
  const blocked = [
    ...(i.failure ? [i.failure] : []),
    ...i.skipped.map((s) => `${s.ticketId}: ${s.note}`),
    ...i.notes
  ]
  out.push(...(blocked.length > 0 ? blocked.map((b) => `- ${clean(b)}`) : ['- 없음']))
  out.push('', '## 결정 요청')
  out.push(...(i.decisions.length > 0 ? i.decisions.map((d) => `- ${clean(d)}`) : ['- 없음']))
  return `${out.join('\n')}\n`
}
