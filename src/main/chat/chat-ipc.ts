import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { IPC_CHANNELS } from '../../shared/api'
import type {
  ChatEvent,
  ChatHistory,
  ChatHrRequestResult,
  ChatHrStatusList,
  ChatReferences,
  ChatSendResult,
  ChatState
} from '../../shared/chat'
import type { ApiResult } from '../../shared/result'
import { NoCompanyError } from '../company/company-context'
import { isTrustedSender } from '../ipc-guard'
import type { ChatService } from './chat-service'

export interface ChatHandlers {
  sendChat: (req: unknown) => Promise<ApiResult<ChatSendResult>>
  cancelChat: () => Promise<ApiResult<{ cancelled: boolean }>>
  getChatHistory: () => Promise<ApiResult<ChatHistory>>
  getChatState: () => Promise<ApiResult<ChatState>>
  resetChat: () => Promise<ApiResult<{ cleared: true }>>
  getChatReferences: () => Promise<ApiResult<ChatReferences>>
  requestHrInstruction: (req: unknown) => Promise<ApiResult<ChatHrRequestResult>>
  getHrInstructionStatuses: () => Promise<ApiResult<ChatHrStatusList>>
}

/** 열린 회사가 없으면 `no-company`, 그 밖의 예외는 내부 정보 없이 `internal`로 돌려준다. */
async function guard<T>(fn: () => Promise<ApiResult<T>>): Promise<ApiResult<T>> {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof NoCompanyError)
      return { ok: false, code: 'no-company', message: '열린 회사가 없습니다.' }
    return { ok: false, code: 'internal', message: '요청을 처리하지 못했습니다.' }
  }
}

const ok = async <T>(v: Promise<T>): Promise<ApiResult<T>> => ({ ok: true, value: await v })

export function createChatHandlers(chat: ChatService): ChatHandlers {
  return {
    sendChat: (req) => guard(() => chat.send(req)),
    cancelChat: () => guard(async () => ({ ok: true, value: { cancelled: chat.cancel() } })),
    getChatHistory: () => guard(() => ok(chat.getHistory())),
    getChatState: () => guard(() => ok(chat.getState())),
    resetChat: () => guard(() => chat.reset()),
    getChatReferences: () => guard(() => ok(chat.references())),
    requestHrInstruction: (req) => guard(() => chat.requestHr(req)),
    getHrInstructionStatuses: () => guard(() => ok(chat.hrStatuses()))
  }
}

/** 열린 앱 창 모두에 이벤트를 보낸다. 닫힌 창은 건너뛴다. */
export function broadcastChatEvent(event: ChatEvent): void {
  for (const win of BrowserWindow.getAllWindows())
    if (!win.isDestroyed() && !win.webContents.isDestroyed())
      win.webContents.send(IPC_CHANNELS.chatEvent, event)
}

export function registerChatHandlers(chat: ChatService): void {
  const h = createChatHandlers(chat)
  const forbidden = { ok: false, code: 'forbidden', message: '허용되지 않은 요청입니다.' } as const
  const reg = <A extends unknown[], T>(
    channel: string,
    fn: (...args: A) => Promise<ApiResult<T>>
  ): void => {
    ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) =>
      isTrustedSender(event) ? fn(...(args as A)) : forbidden
    )
  }
  reg(IPC_CHANNELS.chatSend, h.sendChat)
  // 입력이 없는 채널은 renderer가 보낸 인자를 버린다.
  ipcMain.handle(IPC_CHANNELS.chatCancel, (e) => (isTrustedSender(e) ? h.cancelChat() : forbidden))
  ipcMain.handle(IPC_CHANNELS.chatHistory, (e) =>
    isTrustedSender(e) ? h.getChatHistory() : forbidden
  )
  ipcMain.handle(IPC_CHANNELS.chatState, (e) => (isTrustedSender(e) ? h.getChatState() : forbidden))
  ipcMain.handle(IPC_CHANNELS.chatReset, (e) => (isTrustedSender(e) ? h.resetChat() : forbidden))
  ipcMain.handle(IPC_CHANNELS.chatReferences, (e) =>
    isTrustedSender(e) ? h.getChatReferences() : forbidden
  )
  reg(IPC_CHANNELS.chatHrRequest, h.requestHrInstruction)
  ipcMain.handle(IPC_CHANNELS.chatHrStatus, (e) =>
    isTrustedSender(e) ? h.getHrInstructionStatuses() : forbidden
  )
}
