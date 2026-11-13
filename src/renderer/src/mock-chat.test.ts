import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatEvent } from '../../shared/chat'
import { createMockChatApi, parseChatScenario } from './mock-chat'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('mock chat api', () => {
  it('parses the scenario with idle as default', () => {
    expect(parseChatScenario('')).toBe('idle')
    expect(parseChatScenario('?mock-chat=tick-running')).toBe('tick-running')
    expect(parseChatScenario('?mock-chat=zzz')).toBe('idle')
  })

  it('streams a reply that carries decision and briefing refs', async () => {
    const api = createMockChatApi('idle', 10)
    const events: ChatEvent[] = []
    api.onChatEvent((e) => events.push(e))
    expect(await api.sendChat({ text: '안녕' })).toMatchObject({
      ok: true,
      value: { started: true }
    })
    await vi.advanceTimersByTimeAsync(100)
    expect(events.map((e) => e.type)).toEqual(['started', 'text', 'tool', 'done'])
    const h = await api.getChatHistory()
    expect(h.ok && h.value.messages.at(-1)?.refs.map((r) => r.kind)).toEqual([
      'decision',
      'briefing'
    ])
  })

  it('shows the lock notice while a tick runs and advances hr request states', async () => {
    const locked = createMockChatApi('tick-running')
    expect(await locked.sendChat({ text: 'x' })).toMatchObject({
      value: { reason: 'tick-running' }
    })
    const api = createMockChatApi('idle')
    await api.requestHrInstruction({ text: 'pm 채용' })
    const a = await api.getHrInstructionStatuses()
    const b = await api.getHrInstructionStatuses()
    expect([a, b].map((r) => r.ok && r.value.items[0].status)).toEqual(['running', 'done'])
  })
})
