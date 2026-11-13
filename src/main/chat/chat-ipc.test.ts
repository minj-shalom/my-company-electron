import { describe, expect, it, vi } from 'vitest'
import { NoCompanyError } from '../company/company-context'
import { createChatHandlers } from './chat-ipc'
import type { ChatService } from './chat-service'

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: vi.fn() }
}))

const svc = (over: Partial<Record<keyof ChatService, unknown>>): ChatService =>
  over as unknown as ChatService

describe('chat handlers', () => {
  it('maps a missing company to no-company and hides internal errors', async () => {
    const h = createChatHandlers(
      svc({
        send: async () => {
          throw new NoCompanyError()
        },
        getHistory: async () => {
          throw new Error('/Users/someone/secret path')
        }
      })
    )
    expect(await h.sendChat({ text: 'x' })).toMatchObject({ ok: false, code: 'no-company' })
    const r = await h.getChatHistory()
    expect(r).toMatchObject({ ok: false, code: 'internal' })
    expect(JSON.stringify(r)).not.toContain('secret')
  })

  it('passes untrusted input through to the validating service', async () => {
    const send = vi.fn(async () => ({
      ok: true as const,
      value: { started: false as const, reason: 'limit' as const, message: 'm' }
    }))
    const h = createChatHandlers(svc({ send }))
    await h.sendChat({ text: 1 })
    expect(send).toHaveBeenCalledWith({ text: 1 })
  })
})
