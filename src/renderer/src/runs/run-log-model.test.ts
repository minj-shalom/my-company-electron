import { describe, expect, it, vi } from 'vitest'
import {
  applyEvent,
  applyEvents,
  classifyEvent,
  createBatcher,
  EMPTY_STATE,
  errorText,
  MAX_BODY_CHARS,
  MAX_ENTRIES_PER_RUN,
  registerRun,
  runLabel,
  scrolledAwayFromBottom,
  showEarlier,
  truncateText,
  usageText,
  windowEntries,
  WINDOW_STEP
} from './run-log-model'

const ev = (runId: string, body: Record<string, unknown>): unknown => ({ runId, ...body })
const msg = (runId: string, text: string): unknown =>
  ev(runId, { type: 'message', role: 'assistant', text })

describe('classifyEvent', () => {
  it('maps kinds', () => {
    expect(classifyEvent(msg('r', 'hi'))?.entry?.kind).toBe('message')
    expect(
      classifyEvent(ev('r', { type: 'tool_use', toolUseId: 'a', name: 'Read', input: { a: 1 } }))
        ?.entry
    ).toMatchObject({
      kind: 'tool',
      title: 'Read'
    })
    expect(
      classifyEvent(ev('r', { type: 'tool_result', toolUseId: 'a', content: 'x', isError: true }))
        ?.entry
    ).toMatchObject({ kind: 'result', failed: true })
    expect(classifyEvent(ev('r', { type: 'log', source: 'stderr', line: 'x' }))?.entry?.kind).toBe(
      'other'
    )
    expect(classifyEvent(ev('r', { type: 'start' }))?.entry).toBeNull()
  })
  it('treats unknown types as other and rejects bad input', () => {
    expect(classifyEvent(ev('r', { type: 'from-the-future' }))?.entry?.kind).toBe('other')
    expect(classifyEvent(null)).toBeNull()
    expect(classifyEvent('x')).toBeNull()
    expect(classifyEvent({ type: 'message' })).toBeNull()
    expect(classifyEvent({ runId: 'x'.repeat(65), type: 'message' })).toBeNull()
  })
  it('uses fixed Korean text for errors, never the main message', () => {
    const c = classifyEvent(
      ev('r', { type: 'error', code: 'exit-nonzero', message: '/Users/secret' })
    )
    expect(c?.entry?.text).toBe(errorText('exit-nonzero'))
    expect(c?.entry?.text).not.toContain('secret')
    expect(errorText('weird')).toBe('실행 중 오류가 났어요.')
  })
  it('survives non-serializable tool input', () => {
    const cyc: Record<string, unknown> = {}
    cyc.self = cyc
    expect(
      classifyEvent(ev('r', { type: 'tool_use', toolUseId: 'a', name: 'X', input: cyc }))?.entry
        ?.text
    ).toBe('')
  })
})

describe('truncateText', () => {
  it('cuts oversize bodies', () => {
    expect(truncateText('a'.repeat(MAX_BODY_CHARS))).toMatchObject({ truncated: false })
    const t = truncateText('a'.repeat(MAX_BODY_CHARS + 1))
    expect(t.truncated).toBe(true)
    expect(t.text).toHaveLength(MAX_BODY_CHARS)
  })
  it('truncates in classify', () => {
    expect(classifyEvent(msg('r', 'a'.repeat(30_000)))?.entry?.truncated).toBe(true)
  })
})

describe('status transitions', () => {
  const run = (s: ReturnType<typeof applyEvents>, id = 'r'): string => s.runs[id].status
  it('pending then running then done', () => {
    let s = registerRun(EMPTY_STATE, 'r')
    expect(run(s)).toBe('pending')
    s = applyEvent(s, ev('r', { type: 'start', sessionId: null, model: null }))
    expect(run(s)).toBe('running')
    s = applyEvent(
      s,
      ev('r', {
        type: 'result',
        success: true,
        subtype: 's',
        text: 'ok',
        costUsd: 0.5,
        durationMs: 1500,
        numTurns: 2
      })
    )
    expect(run(s)).toBe('done')
    s = applyEvent(s, ev('r', { type: 'exit', exitCode: 0, signal: null }))
    expect(run(s)).toBe('done')
    expect(s.runs.r.finished).toBe(true)
    expect(usageText(s.runs.r.usage)).toBe('비용 $0.5000 · 1.5초 · 2턴')
  })
  it('error and nonzero exit', () => {
    let s = applyEvents(EMPTY_STATE, [
      ev('r', { type: 'error', code: 'exit-nonzero', message: '' }),
      ev('r', { type: 'exit', exitCode: 1, signal: null })
    ])
    expect(run(s)).toBe('error')
    s = applyEvents(EMPTY_STATE, [
      msg('q', 'x'),
      ev('q', { type: 'exit', exitCode: 2, signal: null })
    ])
    expect(run(s, 'q')).toBe('error')
  })
  it('cancel wins over later error/result', () => {
    const s = applyEvents(EMPTY_STATE, [
      msg('r', 'x'),
      ev('r', { type: 'error', code: 'cancelled', message: '' }),
      ev('r', { type: 'exit', exitCode: null, signal: 'SIGTERM' })
    ])
    expect(run(s)).toBe('cancelled')
  })
  it('ignores events after exit and duplicate tool events', () => {
    let s = applyEvents(EMPTY_STATE, [
      ev('r', { type: 'tool_use', toolUseId: 'a', name: 'X', input: 1 }),
      ev('r', { type: 'tool_use', toolUseId: 'a', name: 'X', input: 1 }),
      ev('r', { type: 'exit', exitCode: 0, signal: null })
    ])
    expect(s.runs.r.entries).toHaveLength(1)
    const before = s
    s = applyEvent(s, msg('r', 'late'))
    expect(s).toBe(before)
  })
  it('usageText handles missing', () => {
    expect(usageText(null)).toBeNull()
    expect(usageText({ costUsd: null, durationMs: null, numTurns: null })).toBeNull()
  })
})

describe('grouping, cap, windowing', () => {
  it('groups by run in arrival order', () => {
    const s = applyEvents(EMPTY_STATE, [msg('a', '1'), msg('b', '2'), msg('a', '3')])
    expect(s.order).toEqual(['a', 'b'])
    expect(s.runs.a.entries.map((e) => e.text)).toEqual(['1', '3'])
    expect(runLabel(s.order, 'b')).toBe('실행 2')
  })
  it('caps entries per run and counts dropped', () => {
    const batch = Array.from({ length: MAX_ENTRIES_PER_RUN + 5 }, (_, i) => msg('r', String(i)))
    const s = applyEvents(EMPTY_STATE, batch)
    expect(s.runs.r.entries).toHaveLength(MAX_ENTRIES_PER_RUN)
    expect(s.runs.r.dropped).toBe(5)
    expect(s.runs.r.entries[0].text).toBe('5')
  })
  it('windows to the latest N and grows on demand', () => {
    let s = applyEvents(
      EMPTY_STATE,
      Array.from({ length: 500 }, (_, i) => msg('r', String(i)))
    )
    let w = windowEntries(s.runs.r)
    expect(w.shown).toHaveLength(WINDOW_STEP)
    expect(w.hidden).toBe(300)
    expect(w.shown.at(-1)?.text).toBe('499')
    s = showEarlier(s, 'r')
    w = windowEntries(s.runs.r)
    expect(w.shown).toHaveLength(WINDOW_STEP * 2)
    expect(showEarlier(s, 'nope')).toBe(s)
  })
  it('drops the oldest finished run beyond the run cap', () => {
    const evs: unknown[] = []
    for (let i = 0; i < 22; i++) {
      evs.push(msg(`r${i}`, 'x'), ev(`r${i}`, { type: 'exit', exitCode: 0, signal: null }))
    }
    const s = applyEvents(EMPTY_STATE, evs)
    expect(s.order).toHaveLength(20)
    expect(s.runs.r0).toBeUndefined()
  })
})

describe('scrolledAwayFromBottom', () => {
  it('detects distance from bottom', () => {
    expect(scrolledAwayFromBottom({ scrollTop: 600, clientHeight: 400, scrollHeight: 1000 })).toBe(
      false
    )
    expect(scrolledAwayFromBottom({ scrollTop: 100, clientHeight: 400, scrollHeight: 1000 })).toBe(
      true
    )
  })
})

describe('createBatcher', () => {
  it('coalesces pushes into one apply per frame and stops after dispose', () => {
    const frames: (() => void)[] = []
    const apply = vi.fn()
    const cancel = vi.fn()
    const b = createBatcher<number>(apply, (cb) => frames.push(cb), cancel)
    b.push(1)
    b.push(2)
    expect(frames).toHaveLength(1)
    frames[0]()
    expect(apply).toHaveBeenCalledWith([1, 2])
    b.push(3)
    b.dispose()
    expect(cancel).toHaveBeenCalled()
    frames[1]()
    expect(apply).toHaveBeenCalledTimes(1)
    b.push(4)
    expect(frames).toHaveLength(2)
  })
})
