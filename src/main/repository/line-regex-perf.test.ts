import { describe, expect, it } from 'vitest'
import { bulletValue, metaValue } from './markdown'
import { withDecisionResolved } from './parse-decision'
import { withTicketStatus } from './parse-ticket'

// 공백이 길고 중간에 단독 \r이 있는 한 줄: `[ \t]*`와 `.*`가 공백을 나눠 가지며 O(n²)가 되던 모양.
const SPACES = ' '.repeat(500_000)
const LIMIT_MS = 3000

function timed(fn: () => unknown): number {
  const t = Date.now()
  fn()
  return Date.now() - t
}

describe('line patterns stay linear on long whitespace with a lone CR', () => {
  it('withTicketStatus', () => {
    expect(
      timed(() => withTicketStatus(`# T-1: x\n- **상태:**${SPACES}\rx\n`, 'done'))
    ).toBeLessThan(LIMIT_MS)
  })
  it('metaValue', () => {
    expect(timed(() => metaValue(`# T-1: x\n- **담당:**${SPACES}\rx\n`, '담당'))).toBeLessThan(
      LIMIT_MS
    )
  })
  it('bulletValue', () => {
    expect(timed(() => bulletValue(`- 선택:${SPACES}\rx\n`, '선택'))).toBeLessThan(LIMIT_MS)
  })
  it('withDecisionResolved status line', () => {
    expect(
      timed(() =>
        withDecisionResolved(`# D-1: x\n- **상태:**${SPACES}\rx\n\n## 결정\n- 선택:\n`, 'A', '')
      )
    ).toBeLessThan(LIMIT_MS)
  })
  it('still treats a line with a lone CR as forged, not as a value', () => {
    expect(metaValue('- **담당:** a\rb\n', '담당')).toBeNull()
    expect(withTicketStatus('# T\n- **상태:** a\rb\n', 'done')).toBe('# T\n- **상태:** a\rb\n')
  })
})
