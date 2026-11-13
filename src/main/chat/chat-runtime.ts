import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { CompanyContext } from '../company/company-context'
import { createJsonStateStore } from '../gate/state-store'
import { ChatHistory } from './chat-history'
import { ChatService, type ChatServiceDeps } from './chat-service'

export interface ChatRuntimeDeps extends Omit<ChatServiceDeps, 'fs' | 'history'> {
  context: CompanyContext
  /** 대화 기록 위치. 회사 폴더가 아니라 앱 userData다. */
  userDataDir: string
}

/** 앱에 하나. 회사마다 기록 파일과 직렬 큐를 따로 쓰고, 회사가 바뀌면 다음 호출부터 새 회사를 본다. */
export function createChatService(deps: ChatRuntimeDeps): ChatService {
  const histories = new Map<string, ChatHistory>()
  return new ChatService({
    ...deps,
    fs: () => deps.context.requireOpenCompany().fs,
    history: () => {
      const root = deps.context.requireOpenCompany().fs.root
      let h = histories.get(root)
      if (!h) {
        const tag = createHash('sha256').update(root).digest('hex').slice(0, 12)
        h = new ChatHistory(createJsonStateStore(join(deps.userDataDir, `chat-${tag}.json`)))
        histories.set(root, h)
      }
      return h
    }
  })
}
